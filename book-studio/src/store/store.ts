import { create } from 'zustand';
import { contentRect, makeImage, makePage, makeText, uid } from '../model/factory';
import type { Asset, Page, PageElement, Project } from '../model/types';
import { saveProject } from './storage';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface State {
  project: Project | null;
  past: Project[];
  future: Project[];
  currentPage: number;
  selection: string[];
  editingId: string | null;
  zoom: number;
  viewMode: 'single' | 'spread';
  showGuides: boolean;
  saveState: SaveState;
  toast: { text: string; kind: 'info' | 'error' } | null;
}

const HISTORY_LIMIT = 100;
let coalesceKey = '';
let coalesceAt = 0;

export const useStore = create<State>(() => ({
  project: null,
  past: [],
  future: [],
  currentPage: 0,
  selection: [],
  editingId: null,
  zoom: 1,
  viewMode: 'spread',
  showGuides: true,
  saveState: 'saved',
  toast: null,
}));

const set = useStore.setState;
const get = useStore.getState;

export function notify(text: string, kind: 'info' | 'error' = 'info') {
  const toast = { text, kind };
  set({ toast });
  setTimeout(() => get().toast === toast && set({ toast: null }), kind === 'error' ? 6000 : 3000);
}

export function openProject(project: Project) {
  set({ project, past: [], future: [], currentPage: 0, selection: [], editingId: null, saveState: 'saved' });
}

export async function closeProject() {
  await flushSave();
  set({ project: null, past: [], future: [], selection: [], editingId: null });
}

/** 현재 상태를 실행 취소 기록에 남긴다. */
export function checkpoint() {
  const { project, past } = get();
  if (!project) return;
  set({ past: [...past.slice(-HISTORY_LIMIT + 1), project], future: [] });
  coalesceKey = '';
}

/**
 * 문서를 변경한다. history=false면 기록을 남기지 않는다(드래그 중간 단계 등).
 * coalesce 키가 같고 연달아 일어난 변경은 실행 취소 한 번으로 묶는다.
 */
export function mutate(fn: (p: Project) => Project, opts: { history?: boolean; coalesce?: string } = {}) {
  const { project } = get();
  if (!project) return;
  const next = fn(project);
  if (next === project) return;
  if (opts.history !== false) {
    const now = Date.now();
    if (!(opts.coalesce && opts.coalesce === coalesceKey && now - coalesceAt < 1500)) checkpoint();
    coalesceKey = opts.coalesce ?? '';
    coalesceAt = now;
  }
  set({ project: { ...next, updatedAt: Date.now() }, saveState: 'dirty' });
  scheduleSave();
}

export function undo() {
  const { project, past, future } = get();
  if (!project || !past.length) return;
  restore(past[past.length - 1], past.slice(0, -1), [project, ...future]);
}

export function redo() {
  const { project, past, future } = get();
  if (!project || !future.length) return;
  restore(future[0], [...past, project], future.slice(1));
}

function restore(project: Project, past: Project[], future: Project[]) {
  const s = get();
  const currentPage = Math.min(s.currentPage, project.pages.length - 1);
  const ids = new Set(project.pages[currentPage].elements.map((e) => e.id));
  set({
    project: { ...project, updatedAt: Date.now() }, past, future, currentPage, editingId: null,
    selection: s.selection.filter((id) => ids.has(id)), saveState: 'dirty',
  });
  coalesceKey = '';
  scheduleSave();
}

// ---- 자동 저장 ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

export function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    const { project, saveState } = get();
    if (!project || saveState === 'saved') return;
    set({ saveState: 'saving' });
    try {
      await saveProject(project);
      if (get().project === project) set({ saveState: 'saved' });
    } catch (e) {
      console.error(e);
      set({ saveState: 'error' });
      notify('저장하지 못했어요. 저장 공간을 확인한 뒤 ‘프로젝트 파일로 저장’으로 백업해 주세요.', 'error');
    }
  });
  return saving;
}

// ---- 편집 동작 ----
const mapPage = (p: Project, pageId: string, fn: (page: Page) => Page): Project => ({
  ...p,
  pages: p.pages.map((pg) => (pg.id === pageId ? fn(pg) : pg)),
});

export function patchElements(
  pageId: string,
  patches: Record<string, Partial<PageElement>>,
  opts?: { history?: boolean; coalesce?: string },
) {
  mutate(
    (p) => mapPage(p, pageId, (pg) => ({
      ...pg,
      elements: pg.elements.map((e) => (patches[e.id] ? ({ ...e, ...patches[e.id] } as PageElement) : e)),
    })),
    opts,
  );
}

export function selectPage(index: number) {
  const { project, currentPage } = get();
  if (!project) return;
  const i = Math.max(0, Math.min(project.pages.length - 1, index));
  if (i !== currentPage) set({ currentPage: i, selection: [], editingId: null });
}

export function addPage(withBody: boolean) {
  const { project, currentPage } = get();
  if (!project) return;
  const at = currentPage + 1;
  mutate((p) => {
    const page = makePage();
    const pages = [...p.pages.slice(0, at), page, ...p.pages.slice(at)];
    const next = { ...p, pages };
    if (withBody) page.elements.push(makeText(contentRect(next, at), ''));
    return next;
  });
  set({ currentPage: at, selection: [], editingId: null });
}

export function duplicatePage(index: number) {
  mutate((p) => {
    const src = p.pages[index];
    const copy: Page = { id: uid(), elements: src.elements.map((e) => ({ ...e, id: uid() })) };
    return { ...p, pages: [...p.pages.slice(0, index + 1), copy, ...p.pages.slice(index + 1)] };
  });
  set({ currentPage: index + 1, selection: [], editingId: null });
}

export function deletePage(index: number) {
  const { project } = get();
  if (!project || project.pages.length <= 1) return;
  mutate((p) => ({ ...p, pages: p.pages.filter((_, i) => i !== index) }));
  set({ currentPage: Math.min(index, project.pages.length - 2), selection: [], editingId: null });
}

export function movePage(from: number, to: number) {
  const { project } = get();
  if (!project || from === to || to < 0 || to >= project.pages.length) return;
  mutate((p) => {
    const pages = [...p.pages];
    const [pg] = pages.splice(from, 1);
    pages.splice(to, 0, pg);
    return { ...p, pages };
  });
  set({ currentPage: to, selection: [], editingId: null });
}

export function addTextBox() {
  const { project, currentPage } = get();
  if (!project) return;
  const c = contentRect(project, currentPage);
  const el = makeText({ x: c.x, y: c.y + c.h / 2 - 15, w: c.w, h: 30 }, '');
  const pageId = project.pages[currentPage].id;
  mutate((p) => mapPage(p, pageId, (pg) => ({ ...pg, elements: [...pg.elements, el] })));
  set({ selection: [el.id], editingId: el.id });
}

export function addImage(asset: Asset) {
  const { project, currentPage } = get();
  if (!project) return;
  const c = contentRect(project, currentPage);
  const ar = asset.pxW / asset.pxH;
  let w = c.w;
  let h = w / ar;
  if (h > c.h) {
    h = c.h;
    w = h * ar;
  }
  const el = makeImage({ x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h }, asset.id);
  const pageId = project.pages[currentPage].id;
  mutate((p) => mapPage({ ...p, assets: { ...p.assets, [asset.id]: asset } }, pageId, (pg) => ({
    ...pg, elements: [...pg.elements, el],
  })));
  set({ selection: [el.id], editingId: null });
}

/** 어느 요소도 쓰지 않는 이미지 원본을 정리한다. */
function pruneAssets(p: Project): Project {
  const used = new Set<string>();
  for (const pg of p.pages) for (const e of pg.elements) if (e.type === 'image') used.add(e.assetId);
  const ids = Object.keys(p.assets);
  if (ids.every((id) => used.has(id))) return p;
  return { ...p, assets: Object.fromEntries(ids.filter((id) => used.has(id)).map((id) => [id, p.assets[id]])) };
}

export function deleteSelection() {
  const { project, currentPage, selection } = get();
  if (!project || !selection.length) return;
  const pageId = project.pages[currentPage].id;
  mutate((p) => pruneAssets(mapPage(p, pageId, (pg) => ({
    ...pg, elements: pg.elements.filter((e) => !selection.includes(e.id)),
  }))));
  set({ selection: [], editingId: null });
}

let clipboard: PageElement[] = [];

export function copySelection() {
  const { project, currentPage, selection } = get();
  if (!project) return;
  clipboard = project.pages[currentPage].elements.filter((e) => selection.includes(e.id));
}

export function pasteClipboard(offset = 4) {
  const { project, currentPage } = get();
  if (!project || !clipboard.length) return;
  // 붙여넣는 이미지의 원본이 정리되었을 수 있으므로 원본이 남아 있는 요소만 붙인다
  const copies = clipboard
    .filter((e) => e.type !== 'image' || project.assets[e.assetId])
    .map((e) => ({ ...e, id: uid(), x: e.x + offset, y: e.y + offset }));
  if (!copies.length) return;
  const pageId = project.pages[currentPage].id;
  mutate((p) => mapPage(p, pageId, (pg) => ({ ...pg, elements: [...pg.elements, ...copies] })));
  clipboard = copies;
  set({ selection: copies.map((e) => e.id), editingId: null });
}

export function reorderSelection(dir: 'front' | 'back') {
  const { project, currentPage, selection } = get();
  if (!project || !selection.length) return;
  const pageId = project.pages[currentPage].id;
  mutate((p) => mapPage(p, pageId, (pg) => {
    const sel = pg.elements.filter((e) => selection.includes(e.id));
    const rest = pg.elements.filter((e) => !selection.includes(e.id));
    return { ...pg, elements: dir === 'front' ? [...rest, ...sel] : [...sel, ...rest] };
  }));
}
