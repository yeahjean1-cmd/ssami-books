import { useEffect, useRef, useState } from 'react';
import hbWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import { browserRasterize, exportPdf } from '../engine/pdf';
import { resolveText } from '../engine/render';
import { derive } from '../engine/flow';
import { presetName } from '../model/presets';
import type { Project } from '../model/types';
import { downloadBlob, safeFilename } from '../store/storage';
import {
  addImage, addPage, addTextBox, addTocPage, openManuscript, closeProject, copySelection, deletePage, deleteSelection, duplicatePage, flushSave,
  movePage, mutate, notify, pasteClipboard, patchElements, redo, selectPage, undo, useStore,
} from '../store/store';
import { Canvas, fitZoom } from './Canvas';
import { pickImageAsset } from './assets';
import { Manuscript } from './Manuscript';
import { PageSvg } from './PageSvg';
import { RightPanel } from './RightPanel';

async function insertImage() {
  const asset = await pickImageAsset();
  if (asset) addImage(asset);
}

const THUMB_W = 76;

const KIND_LABEL = { flow: '본문', toc: '차례', free: '' } as const;

function Thumbnails({ project }: { project: Project }) {
  const currentPage = useStore((s) => s.currentPage);
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const list = useRef<HTMLDivElement>(null);
  const scale = THUMB_W / project.format.width;
  const rowH = Math.round(project.format.height * scale) + 34;
  const page = project.pages[currentPage];
  const auto = page.kind === 'flow' || page.kind === 'toc';

  useEffect(() => {
    const el = list.current!;
    const top = currentPage * rowH;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
    setScroll({ top: el.scrollTop, height: el.clientHeight });
  }, [currentPage, rowH]);

  // 쪽이 수백 개여도 화면에 보이는 썸네일만 그린다
  const first = Math.max(0, Math.floor(scroll.top / rowH) - 3);
  const last = Math.min(project.pages.length, Math.ceil((scroll.top + scroll.height) / rowH) + 3);

  return (
    <aside className="panel left">
      <div className="panel-head">
        <h3>페이지</h3>
        <span id="page-count">{project.pages.length}쪽</span>
      </div>
      <div className="thumbs" ref={list} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        <div style={{ height: project.pages.length * rowH, position: 'relative' }}>
          {project.pages.slice(first, last).map((pg, k) => {
            const i = first + k;
            return (
              <div
                key={pg.id}
                data-index={i}
                className={`thumb${i === currentPage ? ' on' : ''}${dropAt === i ? ' drop' : ''}`}
                style={{ top: i * rowH, height: rowH }}
                draggable
                onClick={() => selectPage(i)}
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropAt(i);
                }}
                onDragLeave={() => setDropAt((x) => (x === i ? null : x))}
                onDrop={() => {
                  if (dragFrom.current !== null) movePage(dragFrom.current, i);
                  dragFrom.current = null;
                  setDropAt(null);
                }}
              >
                <div className="thumb-paper"><PageSvg project={project} pageIndex={i} scale={scale} /></div>
                <span>{i + 1}{KIND_LABEL[pg.kind ?? 'free'] && ` · ${KIND_LABEL[pg.kind ?? 'free']}`}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="panel-foot">
        <button className="btn" id="add-blank" onClick={() => addPage(false)} title="현재 쪽 뒤에 자유롭게 꾸미는 빈 쪽을 추가해요">＋ 빈 쪽</button>
        <button className="btn" id="add-page" onClick={() => addPage(true)} title="현재 쪽 뒤에 글 상자가 있는 쪽을 추가해요">＋ 글 상자</button>
        {project.story && !project.pages.some((p) => p.kind === 'toc') && (
          <button className="btn wide" id="add-toc" onClick={addTocPage} title="장·절 제목과 쪽 번호로 차례를 자동으로 만들어요">＋ 차례 (자동)</button>
        )}
        <button className="btn" id="dup-page" disabled={auto} onClick={() => duplicatePage(currentPage)} title={auto ? '자동으로 만들어지는 쪽은 복제할 수 없어요' : ''}>복제</button>
        <button className="btn" id="del-page" disabled={project.pages.length <= 1 || page.kind === 'flow'} onClick={() => deletePage(currentPage)}
          title={page.kind === 'flow' ? '본문 쪽은 원고 분량에 따라 자동으로 만들어져요. 원고를 줄이면 쪽도 줄어요.' : ''}>삭제</button>
        <button className="btn" disabled={currentPage === 0} onClick={() => movePage(currentPage, currentPage - 1)}>↑ 앞으로</button>
        <button className="btn" disabled={currentPage === project.pages.length - 1} onClick={() => movePage(currentPage, currentPage + 1)}>↓ 뒤로</button>
      </div>
    </aside>
  );
}

const SAVE_LABEL = { saved: '저장됨', dirty: '저장 대기 중…', saving: '저장 중…', error: '저장 실패' } as const;

export function Editor({ project }: { project: Project }) {
  const s = useStore();
  const [exporting, setExporting] = useState(false);
  const canSpread = project.print.duplex;

  const doExportPdf = async () => {
    setExporting(true);
    try {
      const missing = new Set<string>();
      let overflow = 0;
      derive(project).pagination?.missingFonts.forEach((f) => missing.add(f));
      for (const pg of project.pages) for (const el of pg.elements) if (el.type === 'text') {
        const r = resolveText(el);
        if (r?.missingFont) missing.add(el.style.fontFamily);
        if (r?.layout.overflow) overflow++;
      }
      const bytes = await exportPdf(project, {
        rasterize: browserRasterize,
        hbWasm: async () => (await fetch(hbWasmUrl)).arrayBuffer(),
      });
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${safeFilename(project.meta.title)}.pdf`);
      const notes = [
        missing.size ? `없는 폰트(${[...missing].join(', ')})는 기본 서체로 대체했어요.` : '',
        overflow ? `글이 넘친 상자가 ${overflow}개 있어요.` : '',
      ].filter(Boolean);
      notify(notes.length ? `PDF를 만들었어요. ${notes.join(' ')}` : 'PDF를 만들었어요.', notes.length ? 'error' : 'info');
    } catch (e) {
      console.error(e);
      notify(`PDF를 만들지 못했어요. ${e instanceof Error ? e.message : ''}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const exportProjectFile = () => {
    downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }), `${safeFilename(project.meta.title)}.bookstudio`);
    notify('프로젝트 파일을 저장했어요. 이 파일로 다른 기기에서도 이어서 편집할 수 있어요.');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        flushSave().then(() => useStore.getState().saveState === 'saved' && notify('저장했어요.'));
        return;
      }
      if (typing) return;
      const st = useStore.getState();
      if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && key === 'y') { e.preventDefault(); redo(); }
      else if (mod && key === 'c') copySelection();
      else if (mod && key === 'v') { e.preventDefault(); pasteClipboard(); }
      else if (mod && key === 'd') { e.preventDefault(); copySelection(); pasteClipboard(); }
      else if (mod && key === 'a') {
        e.preventDefault();
        useStore.setState({ selection: st.project!.pages[st.currentPage].elements.map((x) => x.id) });
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      else if (e.key === 'Escape') useStore.setState({ selection: [], selectedBlock: null });
      else if (e.key === 'PageDown') selectPage(st.currentPage + 1);
      else if (e.key === 'PageUp') selectPage(st.currentPage - 1);
      else if (e.key.startsWith('Arrow') && st.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 5 : 0.5;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        const pg = st.project!.pages[st.currentPage];
        patchElements(pg.id, Object.fromEntries(pg.elements.filter((x) => st.selection.includes(x.id))
          .map((x) => [x.id, { x: x.x + dx, y: x.y + dy }])), { coalesce: 'nudge' });
      }
    };
    const onUnload = () => { flushSave(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  return (
    <div className="editor">
      <header className="topbar">
        <button className="btn ghost" id="go-home" onClick={() => closeProject()} title="프로젝트 목록으로">← 내 책</button>
        <input
          className="title-input" id="project-title" value={project.meta.title} aria-label="책 제목"
          onChange={(e) => mutate((p) => ({ ...p, meta: { ...p.meta, title: e.target.value } }), { coalesce: 'meta:title' })}
        />
        <div className="group">
          <button className="btn ghost" id="undo" disabled={!s.past.length} onClick={undo} title="실행 취소 (Ctrl+Z)">실행 취소</button>
          <button className="btn ghost" id="redo" disabled={!s.future.length} onClick={redo} title="다시 실행 (Ctrl+Shift+Z)">다시 실행</button>
        </div>
        <div className="group">
          <button className="btn" id="add-text" disabled={s.centerView !== 'pages'} onClick={addTextBox}>글 상자</button>
          <button className="btn" id="add-image" disabled={s.centerView !== 'pages'} onClick={insertImage}>이미지</button>
        </div>
        {project.story && (
          <div className="segmented small" id="view-switch">
            <button className={s.centerView === 'pages' ? 'on' : ''} id="view-pages" onClick={() => useStore.setState({ centerView: 'pages', focus: null })}>페이지</button>
            <button className={s.centerView === 'manuscript' ? 'on' : ''} id="view-manuscript" onClick={() => openManuscript(s.selectedBlock)}>원고</button>
          </div>
        )}
        <div className="spacer" />
        <button className="btn ghost" id="save-file" onClick={exportProjectFile} title="편집 가능한 프로젝트 파일(.bookstudio)로 내보내요">프로젝트 파일로 저장</button>
        <button className="btn primary" id="export-pdf" disabled={exporting} onClick={doExportPdf}>{exporting ? 'PDF 만드는 중…' : 'PDF 내보내기'}</button>
      </header>

      <div className="workspace">
        <Thumbnails project={project} />
        {s.centerView === 'manuscript' && project.story ? <Manuscript project={project} /> : <Canvas project={project} />}
        <RightPanel project={project} />
      </div>

      <footer className="statusbar">
        <div className="group">
          <button className="btn ghost small" disabled={s.currentPage === 0} onClick={() => selectPage(s.currentPage - 1)} aria-label="이전 쪽">‹</button>
          <span id="page-status">{s.currentPage + 1} / {project.pages.length}쪽</span>
          <button className="btn ghost small" disabled={s.currentPage >= project.pages.length - 1} onClick={() => selectPage(s.currentPage + 1)} aria-label="다음 쪽">›</button>
        </div>
        {canSpread && (
          <div className="segmented small">
            <button className={s.viewMode === 'single' ? 'on' : ''} onClick={() => { useStore.setState({ viewMode: 'single' }); fitZoom(project); }}>한 쪽</button>
            <button className={s.viewMode === 'spread' ? 'on' : ''} onClick={() => { useStore.setState({ viewMode: 'spread' }); fitZoom(project); }}>펼침면</button>
          </div>
        )}
        <div className="spacer" />
        <span>{presetName(project.format.presetId)} {project.format.width} × {project.format.height}mm</span>
        <div className="group">
          <button className="btn ghost small" onClick={() => useStore.setState({ zoom: Math.max(0.2, s.zoom / 1.2) })} aria-label="축소">−</button>
          <span id="zoom-status" className="zoom">{Math.round(s.zoom * 100)}%</span>
          <button className="btn ghost small" onClick={() => useStore.setState({ zoom: Math.min(4, s.zoom * 1.2) })} aria-label="확대">＋</button>
          <button className="btn ghost small" onClick={() => fitZoom(project)}>화면에 맞춤</button>
          <button className="btn ghost small" onClick={() => useStore.setState({ zoom: 1 })} title="실제 인쇄 크기에 가깝게 보여줘요">실제 크기</button>
        </div>
        <span id="save-status" className={`save ${s.saveState}`}>{SAVE_LABEL[s.saveState]}</span>
      </footer>
    </div>
  );
}
