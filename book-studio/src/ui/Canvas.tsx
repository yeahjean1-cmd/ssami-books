import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { derivedContent } from '../engine/flow';
import { resolveText } from '../engine/render';
import { PX_PER_MM } from '../engine/units';
import { contentRect, isRightHand } from '../model/factory';
import type { PageElement, Project, Rect, TextElement } from '../model/types';
import { checkpoint, openManuscript, patchElements, selectPage, useStore } from '../store/store';
import { bleedOf } from '../model/cover';
import { PageSvg, rotationOf, useFontsVersion } from './PageSvg';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 3;

interface Drag {
  pageId: string;
  mode: 'move' | Handle;
  startX: number;
  startY: number;
  orig: Record<string, Rect>;
  moved: boolean;
}

function resized(r: Rect, h: Handle, dx: number, dy: number): Rect {
  let { x, y, w, h: hh } = r;
  if (h.includes('e')) w = Math.max(MIN_SIZE, r.w + dx);
  if (h.includes('s')) hh = Math.max(MIN_SIZE, r.h + dy);
  if (h.includes('w')) {
    w = Math.max(MIN_SIZE, r.w - dx);
    x = r.x + r.w - w;
  }
  if (h.includes('n')) {
    hh = Math.max(MIN_SIZE, r.h - dy);
    y = r.y + r.h - hh;
  }
  return { x, y, w, h: hh };
}

/** 펼침면 구성: [왼쪽 쪽 번호, 오른쪽 쪽 번호] (없으면 null) */
export function spreadOf(project: Project, pageIndex: number): [number | null, number | null] {
  if (!project.print.duplex) return [null, pageIndex];
  const right = isRightHand(project, pageIndex);
  const other = right === (project.print.binding === 'left') ? pageIndex - 1 : pageIndex + 1;
  const o = other >= 0 && other < project.pages.length ? other : null;
  return right ? [o, pageIndex] : [pageIndex, o];
}

function TextEditor({ el, pageId, scale, offset }: { el: TextElement; pageId: string; scale: number; offset: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const res = resolveText(el);
  useEffect(() => {
    const t = ref.current!;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  if (!res) return null;
  const s = el.style;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={el.text}
      spellCheck={false}
      onChange={(e) => patchElements(pageId, { [el.id]: { text: e.target.value } }, { coalesce: `text:${el.id}` })}
      onBlur={() => useStore.setState({ editingId: null })}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
      style={{
        left: (el.x + offset) * scale, top: (el.y + offset) * scale, width: el.w * scale, height: el.h * scale,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        fontFamily: `'${res.font.cssFamily}'`, fontWeight: res.font.bold ? 700 : 400,
        fontSize: res.layout.fontSizeMm * scale, lineHeight: s.lineHeight,
        letterSpacing: `${s.letterSpacing / 1000}em`, color: s.color,
        textAlign: s.align === 'justify' ? 'left' : s.align,
        wordBreak: s.wordBreak === 'word' ? 'keep-all' : 'break-all',
      }}
    />
  );
}

interface StageProps {
  project: Project;
  pageIndex: number;
  scale: number;
  /** 표지 편집: 쪽 번호와 무관하게 항상 활성 */
  cover?: boolean;
  bleed?: number;
  background?: string;
  overlay?: React.ReactNode;
}

export function PageStage({ project, pageIndex, scale, cover, bleed = 0, background, overlay }: StageProps) {
  const currentPage = useStore((s) => s.currentPage);
  const selection = useStore((s) => s.selection);
  const editingId = useStore((s) => s.editingId);
  const showGuides = useStore((s) => s.showGuides);
  const selectedBlock = useStore((s) => s.selectedBlock);
  const page = project.pages[pageIndex];
  const active = cover || pageIndex === currentPage;
  const at = cover ? {} : { currentPage: pageIndex };
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  useFontsVersion();

  const begin = (e: React.PointerEvent, el: PageElement, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useStore.getState();
    let sel = cover || st.currentPage === pageIndex ? st.selection : [];
    if (mode === 'move') {
      if (e.shiftKey) sel = sel.includes(el.id) ? sel.filter((id) => id !== el.id) : [...sel, el.id];
      else if (!sel.includes(el.id)) sel = [el.id];
    } else sel = [el.id];
    useStore.setState({ ...at, selection: sel, editingId: null, selectedBlock: null });
    if (!sel.includes(el.id) || el.locked) return; // 잠근 요소는 선택만 된다
    const orig: Record<string, Rect> = {};
    for (const x of page.elements) if (sel.includes(x.id) && !x.locked) orig[x.id] = { x: x.x, y: x.y, w: x.w, h: x.h };
    drag.current = { pageId: page.id, mode, startX: e.clientX, startY: e.clientY, orig, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.startX;
    const dyPx = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dxPx, dyPx) < 3) return;
      d.moved = true;
      checkpoint();
    }
    let dx = dxPx / scale;
    let dy = dyPx / scale;
    if (d.mode === 'move' && !e.altKey) {
      // 쪽 가운데·가장자리·여백선에 가까워지면 달라붙고 안내선을 보여 준다 (Alt를 누르면 끔)
      const rs = Object.values(d.orig);
      const l = Math.min(...rs.map((r) => r.x)) + dx;
      const r = Math.max(...rs.map((q) => q.x + q.w)) + dx;
      const t = Math.min(...rs.map((q) => q.y)) + dy;
      const b = Math.max(...rs.map((q) => q.y + q.h)) + dy;
      const c = contentRect(project, pageIndex);
      const { width: W, height: H } = project.format;
      const tol = 5 / scale;
      const snap = (vals: number[], targets: number[]) => {
        let best: { d: number; t: number } | null = null;
        for (const v of vals) for (const g of targets) if (Math.abs(g - v) < tol && (!best || Math.abs(g - v) < Math.abs(best.d))) best = { d: g - v, t: g };
        return best as { d: number; t: number } | null;
      };
      const sx = snap([l, (l + r) / 2, r], [0, W / 2, W, c.x, c.x + c.w / 2, c.x + c.w]);
      const sy = snap([t, (t + b) / 2, b], [0, H / 2, H, c.y, c.y + c.h / 2, c.y + c.h]);
      if (sx) dx += sx.d;
      if (sy) dy += sy.d;
      setGuides({ x: sx?.t, y: sy?.t });
    }
    const patches: Record<string, Partial<PageElement>> = {};
    for (const [id, r] of Object.entries(d.orig)) {
      patches[id] = d.mode === 'move' ? { x: r.x + dx, y: r.y + dy } : resized(r, d.mode, dx, dy);
    }
    patchElements(d.pageId, patches, { history: false });
  };

  const end = () => {
    drag.current = null;
    setGuides({});
  };

  const hs = 7 / scale;
  const editing = active ? page.elements.find((e) => e.id === editingId && e.type === 'text') : undefined;

  return (
    <div
      className={`page-stage${active ? ' active' : ''}`}
      data-page={pageIndex}
      onPointerDown={() => useStore.setState({ ...at, selection: [], editingId: null, selectedBlock: null })}
    >
      <PageSvg project={project} pageIndex={pageIndex} scale={scale} showGuides={showGuides} editingId={editing?.id} bleed={bleed} background={background} grid>
        {overlay}
        {guides.x !== undefined && <line className="snap-guide" x1={guides.x} x2={guides.x} y1={-bleed} y2={project.format.height + bleed} strokeWidth={1 / scale} />}
        {guides.y !== undefined && <line className="snap-guide" y1={guides.y} y2={guides.y} x1={-bleed} x2={project.format.width + bleed} strokeWidth={1 / scale} />}
        {derivedContent(project, pageIndex).texts.filter((t) => t.blockId && page.kind === 'flow').map((t) => (
          <rect
            key={t.key} data-block={t.blockId} className="block-hit"
            x={t.x} y={t.y} width={t.w} height={t.h} fill={selectedBlock === t.blockId ? 'rgba(139,111,84,.1)' : 'transparent'}
            onPointerDown={(e) => {
              e.stopPropagation();
              useStore.setState({ ...at, selection: [], editingId: null, selectedBlock: t.blockId! });
            }}
            onDoubleClick={() => openManuscript(t.blockId)}
          />
        ))}
        {page.elements.filter((el) => !el.hidden).map((el) => {
          const selected = active && selection.includes(el.id);
          const overflow = el.type === 'text' && resolveText(el)?.layout.overflow;
          return (
            <g key={el.id} transform={rotationOf(el)}>
              <rect
                data-el={el.id}
                x={el.x} y={el.y} width={el.w} height={el.h}
                fill="transparent"
                stroke={selected ? '#8b6f54' : overflow ? '#b5483a' : 'transparent'}
                strokeWidth={(selected ? 1.25 : 1) / scale}
                style={{ cursor: el.locked ? 'default' : 'move' }}
                className="el-hit"
                onPointerDown={(e) => begin(e, el, 'move')}
                onPointerMove={onMove}
                onPointerUp={end}
                onPointerCancel={end}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (el.type === 'text') useStore.setState({ ...at, selection: [el.id], editingId: el.id });
                }}
              />
              {overflow && (
                <g pointerEvents="none" data-overflow={el.id}>
                  <rect x={el.x + el.w - 4 / scale - hs} y={el.y + el.h - hs * 0.9} width={hs * 1.8} height={hs * 1.8} fill="#b5483a" />
                  <text x={el.x + el.w - 4 / scale - hs * 0.1} y={el.y + el.h + hs * 0.55} fontSize={hs * 1.6} fill="#fff" textAnchor="middle" fontWeight={700}>+</text>
                </g>
              )}
            </g>
          );
        })}
        {active && selection.length === 1 && !editing &&
          page.elements.filter((el) => el.id === selection[0] && !el.rotation && !el.locked && !el.hidden).map((el) =>
            HANDLES.map((h) => {
              const cx = el.x + (h.includes('w') ? 0 : h.includes('e') ? el.w : el.w / 2);
              const cy = el.y + (h.includes('n') ? 0 : h.includes('s') ? el.h : el.h / 2);
              const cursor = h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
              return (
                <rect
                  key={h} data-handle={h}
                  x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs}
                  fill="#fffefb" stroke="#8b6f54" strokeWidth={1 / scale} style={{ cursor }}
                  onPointerDown={(e) => begin(e, el, h)}
                  onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
                />
              );
            }),
          )}
      </PageSvg>
      {editing && <TextEditor key={editing.id} el={editing as TextElement} pageId={page.id} scale={scale} offset={bleed} />}
      {!cover && <div className="page-label">{pageIndex + 1}쪽</div>}
    </div>
  );
}

export function Canvas({ project }: { project: Project }) {
  const currentPage = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const viewMode = useStore((s) => s.viewMode);
  const bleed = useStore((s) => s.showBleed) ? bleedOf(project) : 0;
  const ref = useRef<HTMLDivElement>(null);
  const scale = zoom * PX_PER_MM;

  const spread = viewMode === 'spread' && project.print.duplex;
  const [left, right] = spread ? spreadOf(project, currentPage) : [null, currentPage];

  // Ctrl+휠 확대/축소
  useEffect(() => {
    const el = ref.current!;
    let acc = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // 휠을 굴리면 앞뒤 쪽(펼침면)으로 넘긴다. 확대해서 화면이 스크롤될 때는 끝까지 스크롤한 뒤에 넘어간다.
        if ((e.target as HTMLElement).closest('textarea') || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
        const down = e.deltaY > 0;
        const canScroll = down ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
        if (canScroll) return;
        e.preventDefault();
        const now = Date.now();
        if (now - last < 260) return; // 터치패드의 관성 스크롤로 여러 쪽이 한꺼번에 넘어가지 않게 한다
        acc = Math.sign(acc) === Math.sign(e.deltaY) ? acc + e.deltaY : e.deltaY;
        if (Math.abs(acc) < 40) return;
        acc = 0;
        last = now;
        const st = useStore.getState();
        const p = st.project;
        if (!p || st.editingId) return;
        const pair: (number | null)[] = st.viewMode === 'spread' && p.print.duplex ? spreadOf(p, st.currentPage) : [st.currentPage];
        const shown = pair.filter((x): x is number => x !== null);
        selectPage(down ? Math.max(...shown) + 1 : Math.min(...shown) - 1);
        return;
      }
      e.preventDefault();
      const z = useStore.getState().zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      useStore.setState({ zoom: Math.max(0.2, Math.min(4, z)) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 프로젝트를 처음 열 때 화면에 맞춘다
  useLayoutEffect(() => {
    fitZoom(project, ref.current!);
  }, [project.id]);

  return (
    <div className="canvas" ref={ref} id="canvas" onPointerDown={() => useStore.setState({ selection: [], editingId: null, selectedBlock: null })}>
      <div className="spread">
        {spread && (left !== null
          ? <PageStage project={project} pageIndex={left} scale={scale} bleed={bleed} />
          : <div className="page-blank" style={{ width: project.format.width * scale, height: project.format.height * scale }} />)}
        {right !== null
          ? <PageStage project={project} pageIndex={right} scale={scale} bleed={bleed} />
          : <div className="page-blank" style={{ width: project.format.width * scale, height: project.format.height * scale }} />}
      </div>
    </div>
  );
}

export function fitZoom(project: Project, el: HTMLElement | null = document.getElementById('canvas')) {
  if (!el) return;
  const { viewMode } = useStore.getState();
  const n = viewMode === 'spread' && project.print.duplex ? 2 : 1;
  const zw = (el.clientWidth - 96) / (project.format.width * n * PX_PER_MM);
  const zh = (el.clientHeight - 96) / (project.format.height * PX_PER_MM);
  const z = Math.min(zw, zh);
  if (z > 0) useStore.setState({ zoom: Math.max(0.2, Math.min(4, z)) });
}

/** 공통 요소 보기: 여기에 놓은 배경·장식은 모든 쪽 아래에 깔린다. */
export function MasterView({ project }: { project: Project }) {
  const zoom = useStore((s) => s.zoom);
  const scale = zoom * PX_PER_MM;
  const doc: Project = {
    ...project, story: undefined, styles: undefined, master: undefined, masterElements: undefined,
    pages: [{ id: 'master', kind: 'free', elements: project.masterElements ?? [] }],
  };
  return (
    <div className="canvas" id="canvas" onPointerDown={() => useStore.setState({ selection: [], editingId: null })}>
      <div className="spread cover-spread">
        <div>
          <p className="cover-legend" style={{ marginBottom: 12 }}>공통 요소 — 여기에 놓은 글·이미지·도형은 모든 쪽의 본문 아래에 깔려요. ‘공통 요소 숨기기’를 켠 쪽에는 나오지 않아요.</p>
          <PageStage project={doc} pageIndex={0} scale={scale} cover bleed={bleedOf(project)} />
        </div>
      </div>
    </div>
  );
}
