import hbWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import { useMemo, useState } from 'react';
import { derive } from '../engine/flow';
import { browserRasterize, exportPdf, type ExportOptions } from '../engine/pdf';
import { preflight, type Issue } from '../engine/preflight';
import type { Project } from '../model/types';
import { downloadBlob, safeFilename } from '../store/storage';
import { notify, useStore } from '../store/store';

const LEVEL = { error: '오류', warn: '경고', info: '정보' } as const;

export const usePreflight = (project: Project) => useMemo(() => preflight(project), [project]);

function goTo(issue: Issue) {
  if (issue.cover) useStore.setState({ centerView: 'cover', selection: issue.elementId ? [issue.elementId] : [], editingId: null, selectedBlock: null, focus: null });
  else if (issue.page !== undefined) {
    useStore.setState({ centerView: 'pages', currentPage: issue.page, selection: issue.elementId ? [issue.elementId] : [], editingId: null, selectedBlock: null, focus: null });
  }
}

export function PreflightDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const issues = usePreflight(project);
  const count = (l: Issue['level']) => issues.filter((i) => i.level === l).length;
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="인쇄 사전 검사" id="preflight">
        <div className="modal-head">
          <h2>인쇄 사전 검사</h2>
          <p className="modal-sub" id="preflight-summary">오류 {count('error')} · 경고 {count('warn')} · 정보 {count('info')}</p>
        </div>
        <div className="modal-body import-body">
          {count('error') + count('warn') === 0 && <div className="notice ok">인쇄에 문제가 될 만한 곳을 찾지 못했어요.</div>}
          <div className="issue-list">
            {issues.map((it, i) => {
              const where = it.cover ? '표지' : it.page !== undefined ? `${it.page + 1}쪽` : '책 전체';
              const can = it.cover || it.page !== undefined;
              return (
                <button key={i} className={`issue ${it.level}`} disabled={!can} onClick={() => { goTo(it); onClose(); }} title={can ? '눌러서 해당 위치로 이동' : ''}>
                  <span className="lv">{LEVEL[it.level]}</span>
                  <span className="where">{where}</span>
                  <span className="msg">{it.text}</span>
                </button>
              );
            })}
          </div>
          <p className="hint">
            <b>오류</b>는 인쇄 진행에 문제가 생길 수 있는 항목, <b>경고</b>는 품질에 영향을 줄 수 있는 항목, <b>정보</b>는 확인해 두면 좋은 항목이에요.
            검사를 통과해도 인쇄소의 장비(RIP)와 제작 기준에 따라 결과가 달라질 수 있으니, 파일을 넘길 때 인쇄소의 확인을 꼭 받아 주세요.
          </p>
        </div>
        <div className="modal-foot"><div className="spacer" /><button className="btn primary" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

type Preset = 'screen' | 'proof' | 'print';
const PRESETS: { id: Preset; name: string; hint: string }[] = [
  { id: 'screen', name: '화면용', hint: '완성 크기 그대로, RGB. 읽거나 공유할 때' },
  { id: 'proof', name: '검수용', hint: '도련과 재단선을 함께 표시, RGB. 편집 결과를 확인할 때' },
  { id: 'print', name: '인쇄용', hint: '도련 포함, 글자·도형 CMYK. 인쇄소에 넘길 때' },
];

export function ExportDialog({ project, onClose, onPreflight }: { project: Project; onClose: () => void; onPreflight: () => void }) {
  const issues = usePreflight(project);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const [preset, setPreset] = useState<Preset>('screen');
  const [interior, setInterior] = useState(true);
  const [cover, setCover] = useState(!!project.cover);
  const [marks, setMarks] = useState(true);
  const [pdfx, setPdfx] = useState(!!project.print.profile);
  const [busy, setBusy] = useState(false);
  const profile = project.print.profile;

  const run = async () => {
    setBusy(true);
    try {
      const base: ExportOptions = {
        rasterize: browserRasterize,
        hbWasm: async () => (await fetch(hbWasmUrl)).arrayBuffer(),
        bleed: preset !== 'screen',
        marks: preset === 'proof' || (preset === 'print' && marks),
        cmyk: preset === 'print',
        pdfx: preset === 'print' && pdfx && !!profile,
      };
      if (base.pdfx) base.srgbProfile = new Uint8Array(await (await fetch('icc/sRGB-v2-micro.icc')).arrayBuffer());
      const suffix = preset === 'print' ? '_인쇄용' : preset === 'proof' ? '_검수용' : '';
      const name = safeFilename(project.meta.title);
      const targets = [...(interior ? (['interior'] as const) : []), ...(cover && project.cover ? (['cover'] as const) : [])];
      for (const target of targets) {
        const bytes = await exportPdf(project, { ...base, target });
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${name}_${target === 'cover' ? '표지' : '내지'}${suffix}.pdf`);
      }
      const missing = derive(project).pagination?.missingFonts.size ?? 0;
      notify(`PDF ${targets.length}개를 만들었어요.${missing ? ' 없는 폰트는 기본 서체로 대체했어요.' : ''}`);
      onClose();
    } catch (e) {
      console.error(e);
      notify(`PDF를 만들지 못했어요. ${e instanceof Error ? e.message : ''}`, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal narrow" role="dialog" aria-label="PDF 내보내기" id="export-dialog">
        <div className="modal-head"><h2>PDF 내보내기</h2></div>
        <div className="modal-body import-body">
          <div className="export-presets">
            {PRESETS.map((p) => (
              <button key={p.id} data-preset={p.id} className={`preset tpl${preset === p.id ? ' on' : ''}`} onClick={() => setPreset(p.id)}>
                <strong>{p.name}</strong><small>{p.hint}</small>
              </button>
            ))}
          </div>
          <div className="row wrap">
            <label className="check"><input id="ex-interior" type="checkbox" checked={interior} onChange={(e) => setInterior(e.target.checked)} />내지 ({project.pages.length}쪽, 낱장 순서)</label>
            <label className="check"><input id="ex-cover" type="checkbox" checked={cover && !!project.cover} disabled={!project.cover} onChange={(e) => setCover(e.target.checked)} />
              표지 {project.cover ? '(펼침면 1장)' : '(아직 없음)'}</label>
          </div>
          {preset === 'print' && (
            <>
              <div className="row wrap">
                <label className="check"><input id="ex-marks" type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />재단선 넣기</label>
                <label className="check"><input id="ex-pdfx" type="checkbox" checked={pdfx && !!profile} disabled={!profile} onChange={(e) => setPdfx(e.target.checked)} />PDF/X-4 규격 정보 넣기</label>
              </div>
              <div className="notice info">
                <ul>
                  <li>글자와 도형은 CMYK로, 검정 글자는 먹 1도(K100)로 내보내요. 이미지는 sRGB로 넣고 인쇄소 장비가 CMYK로 바꿔요.</li>
                  <li>{profile ? `출력 프로파일: ${profile.name}` : 'PDF/X-4는 인쇄소가 지정한 CMYK 출력 프로파일(ICC)이 있어야 해요. 문서 설정의 ‘인쇄 설정’에서 불러올 수 있어요.'}</li>
                  <li>이 프로그램의 PDF/X-4 출력은 아직 공인 검증 도구나 실제 인쇄소 출력으로 확인되지 않았어요. 넘기기 전에 인쇄소의 사전 검사를 꼭 받아 주세요.</li>
                </ul>
              </div>
            </>
          )}
          <button className={`preflight-chip ${errors ? 'error' : warns ? 'warn' : 'ok'}`} id="ex-preflight" onClick={onPreflight}>
            사전 검사: 오류 {errors} · 경고 {warns} — 자세히 보기
          </button>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" disabled={busy} onClick={onClose}>취소</button>
          <div className="spacer" />
          <button className="btn primary" id="ex-run" disabled={busy || (!interior && !(cover && project.cover))} onClick={run}>{busy ? 'PDF 만드는 중…' : '내보내기'}</button>
        </div>
      </div>
    </div>
  );
}
