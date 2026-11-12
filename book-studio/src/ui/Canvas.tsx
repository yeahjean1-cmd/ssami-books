import { useEffect, useLayoutEffect, useRef } from 'react';
import { derivedContent } from '../engine/flow';
import { resolveText } from '../engine/render';
import { PX_PER_MM } from '../engine/units';
import { isRightHand } from '../model/factory';
import type { PageElement, Project, Rect, TextElement } from '../model/types';
import { checkpoint, openManuscript, patchElements, useStore } from '../store/store';
import { PageSvg, useFontsVersion } from './PageSvg';

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

function TextEditor({ el, pageId, scale }: { el: TextElement; pageId: string; scale: number }) {
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
        left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
        fontFamily: `'${res.font.cssFamily}'`, fontWeight: res.font.bold ? 700 : 400,
        fontSize: res.layout.fontSizeMm * scale, lineHeight: s.lineHeight,
        letterSpacing: `${s.letterSpacing / 1000}em`, color: s.color,
        textAlign: s.align === 'justify' ? 'left' : s.align,
        wordBreak: s.wordBreak === 'word' ? 'keep-all' : 'break-all',
      }}
    />
  );
}

function PageStage({ project, pageIndex, scale }: { project: Project; pageIndex: number; scale: number }) {
  const currentPage = useStore((s) => s.currentPage);
  const selection = useStore((s) => s.selection);
  const editingId = useStore((s) => s.editingId);
  const showGuides = useStore((s) => s.showGuides);
  const selectedBlock = useStore((s) => s.selectedBlock);
  const page = project.pages[pageIndex];
  const active = pageIndex === currentPage;
  const drag = useRef<Drag | null>(null);
  useFontsVersion();

  const begin = (e: React.PointerEvent, el: PageElement, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useStore.getState();
    let sel = st.currentPage === pageIndex ? st.selection : [];
    if (mode === 'move') {
      if (e.shiftKey) sel = sel.includes(el.id) ? sel.filter((id) => id !== el.id) : [...sel, el.id];
      else if (!sel.includes(el.id)) sel = [el.id];
    } else sel = [el.id];
    useStore.setState({ currentPage: pageIndex, selection: sel, editingId: null, selectedBlock: null });
    if (!sel.includes(el.id)) return;
    const orig: Record<string, Rect> = {};
    for (const x of page.elements) if (sel.includes(x.id)) orig[x.id] = { x: x.x, y: x.y, w: x.w, h: x.h };
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
    const dx = dxPx / scale;
    const dy = dyPx / scale;
    const patches: Record<string, Partial<PageElement>> = {};
    for (const [id, r] of Object.entries(d.orig)) {
      patches[id] = d.mode === 'move' ? { x: r.x + dx, y: r.y + dy } : resized(r, d.mode, dx, dy);
    }
    patchElements(d.pageId, patches, { history: false });
  };

  const end = () => {
    drag.current = null;
  };

  const hs = 7 / scale;
  const editing = active ? page.elements.find((e) => e.id === editingId && e.type === 'text') : undefined;

  return (
    <div
      className={`page-stage${active ? ' active' : ''}`}
      data-page={pageIndex}
      onPointerDown={() => useStore.setState({ currentPage: pageIndex, selection: [], editingId: null, selectedBlock: null })}
    >
      <PageSvg project={project} pageIndex={pageIndex} scale={scale} showGuides={showGuides} editingId={editing?.id}>
        {derivedContent(project, pageIndex).texts.filter((t) => t.blockId && page.kind === 'flow').map((t) => (
          <rect
            key={t.key} data-block={t.blockId} className="block-hit"
            x={t.x} y={t.y} width={t.w} height={t.h} fill={selectedBlock === t.blockId ? 'rgba(139,111,84,.1)' : 'transparent'}
            onPointerDown={(e) => {
              e.stopPropagation();
              useStore.setState({ currentPage: pageIndex, selection: [], editingId: null, selectedBlock: t.blockId! });
            }}
            onDoubleClick={() => openManuscript(t.blockId)}
          />
        ))}
        {page.elements.map((el) => {
          const selected = active && selection.includes(el.id);
          const overflow = el.type === 'text' && resolveText(el)?.layout.overflow;
          return (
            <g key={el.id}>
              <rect
                data-el={el.id}
                x={el.x} y={el.y} width={el.w} height={el.h}
                fill="transparent"
                stroke={selected ? '#8b6f54' : overflow ? '#b5483a' : 'transparent'}
                strokeWidth={(selected ? 1.25 : 1) / scale}
                style={{ cursor: 'move' }}
                className="el-hit"
                onPointerDown={(e) => begin(e, el, 'move')}
                onPointerMove={onMove}
                onPointerUp={end}
                onPointerCancel={end}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (el.type === 'text') useStore.setState({ currentPage: pageIndex, selection: [el.id], editingId: el.id });
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
          page.elements.filter((el) => el.id === selection[0]).map((el) =>
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
      {editing && <TextEditor key={editing.id} el={editing as TextElement} pageId={page.id} scale={scale} />}
      <div className="page-label">{pageIndex + 1}쪽</div>
    </div>
  );
}

export function Canvas({ project }: { project: Project }) {
  const currentPage = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const viewMode = useStore((s) => s.viewMode);
  const ref = useRef<HTMLDivElement>(null);
  const scale = zoom * PX_PER_MM;

  const spread = viewMode === 'spread' && project.print.duplex;
  const [left, right] = spread ? spreadOf(project, currentPage) : [null, currentPage];

  // Ctrl+휠 확대/축소
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
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
          ? <PageStage project={project} pageIndex={left} scale={scale} />
          : <div className="page-blank" style={{ width: project.format.width * scale, height: project.format.height * scale }} />)}
        {right !== null
          ? <PageStage project={project} pageIndex={right} scale={scale} />
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
