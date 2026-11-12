import { create } from 'zustand';
import { derive, syncPages } from '../engine/flow';
import { contentRect, makeBlock, makeImage, makePage, makeText, uid } from '../model/factory';
import { bleedOf, coverGeom, frontRect, fromDisplay, makeCover, toDisplay } from '../model/cover';
import { templateCopy } from '../model/templates';
import type { Asset, Block, Cover, Master, Page, PageElement, ParaStyle, Project, Rect, StyleName, TocSettings } from '../model/types';
import { saveProject, saveSnapshot } from './storage';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface State {
  project: Project | null;
  past: Project[];
  future: Project[];
  currentPage: number;
  selection: string[];
  editingId: string | null;
  /** 본문 흐름에서 선택한 문단 */
  selectedBlock: string | null;
  centerView: 'pages' | 'manuscript' | 'cover' | 'master';
  /** 내지에서 도련 영역을 함께 보여 준다 */
  showBleed: boolean;
  /** 원고 보기에서 커서를 둘 문단과 위치 */
  focus: { id: string; caret: number } | null;
  zoom: number;
  viewMode: 'single' | 'spread';
  showGuides: boolean;
  saveState: SaveState;
  /** 내 템플릿·인쇄소 프로파일 목록이 바뀔 때마다 올라간다 */
  libraryVersion: number;
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
  selectedBlock: null,
  centerView: 'pages',
  showBleed: false,
  focus: null,
  zoom: 1,
  viewMode: 'spread',
  showGuides: true,
  saveState: 'saved',
  libraryVersion: 0,
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
  const synced = syncPages(project, uid);
  set({
    project: synced, past: [], future: [], currentPage: 0, selection: [], editingId: null, selectedBlock: null,
    centerView: 'pages', focus: null, saveState: synced === project ? 'saved' : 'dirty',
  });
  // 책을 열 때의 상태를 복원 지점으로 남긴다
  lastSnapshot = Date.now();
  saveSnapshot(synced).catch(() => {});
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
  const changed = fn(project);
  if (changed === project) return;
  // 원고 분량이 바뀌면 본문·목차 쪽 수를 맞춘다
  const next = syncPages(changed, uid);
  if (opts.history !== false) {
    const now = Date.now();
    if (!(opts.coalesce && opts.coalesce === coalesceKey && now - coalesceAt < 1500)) checkpoint();
    coalesceKey = opts.coalesce ?? '';
    coalesceAt = now;
  }
  const s = get();
  set({
    project: { ...next, updatedAt: Date.now() }, saveState: 'dirty',
    currentPage: Math.min(s.currentPage, next.pages.length - 1),
  });
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
let lastSnapshot = 0;
const SNAPSHOT_EVERY = 10 * 60 * 1000;

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
      if (Date.now() - lastSnapshot > SNAPSHOT_EVERY) {
        lastSnapshot = Date.now();
        await saveSnapshot(project).catch(() => {});
      }
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
export const COVER_ID = 'cover';
export const MASTER_ID = 'master';

/** 쪽(또는 표지)의 요소를 바꾼다. 표지는 화면 좌표로 고친 뒤 책등과 무관한 저장 좌표로 되돌린다. */
const mapPage = (p: Project, pageId: string, fn: (page: Page) => Page): Project => {
  if (pageId === MASTER_ID) return { ...p, masterElements: fn({ id: MASTER_ID, elements: p.masterElements ?? [] }).elements };
  if (pageId !== COVER_ID) return { ...p, pages: p.pages.map((pg) => (pg.id === pageId ? fn(pg) : pg)) };
  if (!p.cover) return p;
  const g = coverGeom(p);
  const page = fn({ id: COVER_ID, elements: p.cover.elements.map((e) => toDisplay(e, g)) });
  return { ...p, cover: { ...p.cover, elements: page.elements.map((e) => fromDisplay(e, g)) } };
};

/** 지금 편집 중인 면: 내지의 현재 쪽 또는 표지 */
export function surfaceOf(project: Project, centerView: string, currentPage: number): { pageId: string; elements: PageElement[]; place: Rect } {
  if (centerView === 'cover' && project.cover) {
    const g = coverGeom(project);
    const f = frontRect(project, g);
    const m = 15;
    return { pageId: COVER_ID, elements: project.cover.elements.map((e) => toDisplay(e, g)), place: { x: f.x + m, y: m, w: f.w - m * 2, h: f.h - m * 2 } };
  }
  if (centerView === 'master') return { pageId: MASTER_ID, elements: project.masterElements ?? [], place: contentRect(project, 0) };
  const page = project.pages[currentPage];
  return { pageId: page.id, elements: page.elements, place: contentRect(project, currentPage) };
}
export const surface = () => {
  const s = get();
  return surfaceOf(s.project!, s.centerView, s.currentPage);
};

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
  const kind = project.pages[index].kind;
  if (kind === 'flow') return; // 본문 쪽은 원고 분량에 따라 자동으로 관리된다
  // 차례는 여러 쪽이어도 한 묶음이므로 함께 지운다
  mutate((p) => ({ ...p, pages: p.pages.filter((pg, i) => (kind === 'toc' ? pg.kind !== 'toc' : i !== index)) }));
  set({ currentPage: Math.min(index, get().project!.pages.length - 1), selection: [], editingId: null });
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
  const c = surface().place;
  const el = makeText({ x: c.x, y: c.y + c.h / 2 - 15, w: c.w, h: 30 }, '');
  const { pageId } = surface();
  mutate((p) => mapPage(p, pageId, (pg) => ({ ...pg, elements: [...pg.elements, el] })));
  set({ selection: [el.id], editingId: el.id });
}

export function addImage(asset: Asset) {
  const { project, currentPage } = get();
  if (!project) return;
  const c = surface().place;
  const ar = asset.pxW / asset.pxH;
  let w = c.w;
  let h = w / ar;
  if (h > c.h) {
    h = c.h;
    w = h * ar;
  }
  const el = makeImage({ x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h }, asset.id);
  const { pageId } = surface();
  mutate((p) => mapPage({ ...p, assets: { ...p.assets, [asset.id]: asset } }, pageId, (pg) => ({
    ...pg, elements: [...pg.elements, el],
  })));
  set({ selection: [el.id], editingId: null });
}

/** 어느 요소도 쓰지 않는 이미지 원본을 정리한다. */
function pruneAssets(p: Project): Project {
  const used = new Set<string>();
  for (const pg of p.pages) for (const e of pg.elements) if (e.type === 'image') used.add(e.assetId);
  for (const b of p.story ?? []) if (b.assetId) used.add(b.assetId);
  for (const e of [...(p.cover?.elements ?? []), ...(p.masterElements ?? [])]) if (e.type === 'image') used.add(e.assetId);
  const ids = Object.keys(p.assets);
  if (ids.every((id) => used.has(id))) return p;
  return { ...p, assets: Object.fromEntries(ids.filter((id) => used.has(id)).map((id) => [id, p.assets[id]])) };
}

export function deleteSelection() {
  const { project, currentPage, selection } = get();
  if (!project || !selection.length) return;
  const { pageId } = surface();
  mutate((p) => pruneAssets(mapPage(p, pageId, (pg) => ({
    ...pg, elements: pg.elements.filter((e) => !selection.includes(e.id) || e.locked),
  }))));
  // 잠겨서 지워지지 않은 요소는 선택된 채로 둔다
  const left = new Set(surface().elements.map((e) => e.id));
  set({ selection: selection.filter((id) => left.has(id)), editingId: null });
}

let clipboard: PageElement[] = [];

export function copySelection() {
  const { project, currentPage, selection } = get();
  if (!project) return;
  clipboard = surface().elements.filter((e) => selection.includes(e.id));
}

export function pasteClipboard(offset = 4) {
  const { project, currentPage } = get();
  if (!project || !clipboard.length) return;
  // 붙여넣는 이미지의 원본이 정리되었을 수 있으므로 원본이 남아 있는 요소만 붙인다
  const copies = clipboard
    .filter((e) => e.type !== 'image' || project.assets[e.assetId])
    .map((e) => ({ ...e, id: uid(), x: e.x + offset, y: e.y + offset }));
  if (!copies.length) return;
  const { pageId } = surface();
  mutate((p) => mapPage(p, pageId, (pg) => ({ ...pg, elements: [...pg.elements, ...copies] })));
  clipboard = copies;
  set({ selection: copies.map((e) => e.id), editingId: null });
}

export function reorderSelection(dir: 'front' | 'back') {
  const { project, currentPage, selection } = get();
  if (!project || !selection.length) return;
  const { pageId } = surface();
  mutate((p) => mapPage(p, pageId, (pg) => {
    const sel = pg.elements.filter((e) => selection.includes(e.id));
    const rest = pg.elements.filter((e) => !selection.includes(e.id));
    return { ...pg, elements: dir === 'front' ? [...rest, ...sel] : [...sel, ...rest] };
  }));
}

// ---- 원고(자동 조판) ----
const mapStory = (p: Project, fn: (story: Block[]) => Block[]): Project => ({ ...p, story: fn(p.story ?? []) });

export function patchBlock(id: string, patch: Partial<Block>, coalesce?: string) {
  mutate((p) => mapStory(p, (st) => st.map((b) => (b.id === id ? { ...b, ...patch } : b))), { coalesce });
}

/** 커서 위치에서 문단을 둘로 나눈다. 제목 뒤에는 본문 문단이 이어진다. */
export function splitBlock(id: string, pos: number) {
  const b = get().project?.story?.find((x) => x.id === id);
  if (!b) return;
  const tail = makeBlock(b.style === 'chapter' || b.style === 'section' ? 'body' : b.style, b.text.slice(pos));
  mutate((p) => mapStory(p, (st) => st.flatMap((x) => (x.id === id ? [{ ...x, text: x.text.slice(0, pos) }, tail] : [x]))));
  set({ focus: { id: tail.id, caret: 0 } });
}

/** 문단을 앞 문단에 이어 붙인다. */
export function mergeBlockUp(id: string) {
  const story = get().project?.story ?? [];
  const i = story.findIndex((x) => x.id === id);
  if (i <= 0 || story[i - 1].assetId) return;
  const prev = story[i - 1];
  mutate((p) => mapStory(p, (st) => st.flatMap((x) => (x.id === id ? [] : x.id === prev.id ? [{ ...x, text: x.text + story[i].text }] : [x]))));
  set({ focus: { id: prev.id, caret: prev.text.length }, selectedBlock: null });
}

export function insertBlockAfter(afterId: string | null, block: Block) {
  mutate((p) => mapStory(p, (st) => {
    const i = afterId ? st.findIndex((x) => x.id === afterId) : -1;
    return i < 0 ? [...st, block] : [...st.slice(0, i + 1), block, ...st.slice(i + 1)];
  }));
  if (!block.assetId) set({ focus: { id: block.id, caret: 0 } });
}

export function insertStoryImage(afterId: string | null, asset: Asset) {
  const block = makeBlock('body', '', { assetId: asset.id });
  mutate((p) => mapStory({ ...p, assets: { ...p.assets, [asset.id]: asset } }, (st) => {
    const i = afterId ? st.findIndex((x) => x.id === afterId) : -1;
    return i < 0 ? [...st, block] : [...st.slice(0, i + 1), block, ...st.slice(i + 1)];
  }));
}

export function removeBlock(id: string) {
  mutate((p) => pruneAssets(mapStory(p, (st) => st.filter((x) => x.id !== id))));
  if (get().selectedBlock === id) set({ selectedBlock: null });
}

export function patchStyle(name: StyleName, patch: Partial<ParaStyle>, key: string) {
  mutate((p) => (p.styles ? { ...p, styles: { ...p.styles, [name]: { ...p.styles[name], ...patch } } } : p), { coalesce: `style:${name}:${key}` });
}

export function patchMaster(fn: (m: Master) => Master, key: string) {
  mutate((p) => (p.master ? { ...p, master: fn(p.master) } : p), { coalesce: `master:${key}` });
}

export function patchToc(patch: Partial<TocSettings>, key: string) {
  mutate((p) => (p.toc ? { ...p, toc: { ...p.toc, ...patch } } : p), { coalesce: `toc:${key}` });
}

export function applyTemplate(id: string) {
  mutate((p) => ({ ...p, ...templateCopy(id) }));
}

/** 차례 쪽을 본문 앞에 넣는다. 내용과 쪽 번호는 원고에서 자동으로 만들어진다. */
export function addTocPage() {
  const { project } = get();
  if (!project?.story || project.pages.some((p) => p.kind === 'toc')) return;
  const firstFlow = project.pages.findIndex((p) => p.kind === 'flow');
  const at = firstFlow < 0 ? project.pages.length : firstFlow;
  mutate((p) => ({ ...p, pages: [...p.pages.slice(0, at), makePage('toc'), ...p.pages.slice(at)] }));
  set({ currentPage: at, selection: [], editingId: null, selectedBlock: null });
}

export function patchPage(index: number, patch: Partial<Page>) {
  mutate((p) => ({ ...p, pages: p.pages.map((pg, i) => (i === index ? { ...pg, ...patch } : pg)) }));
}

/** 문단이 놓인 쪽으로 이동한다. */
export function goToBlock(id: string) {
  const { project } = get();
  if (!project) return;
  const d = derive(project);
  const fi = d.pagination?.blockPage.get(id);
  const page = d.flowIndex.indexOf(fi ?? -2);
  set({ centerView: 'pages', selectedBlock: id, selection: [], editingId: null, ...(page >= 0 ? { currentPage: page } : {}) });
}

export function openManuscript(blockId?: string | null) {
  const b = get().project?.story?.find((x) => x.id === blockId);
  set({ centerView: 'manuscript', selection: [], editingId: null, focus: b && !b.assetId ? { id: b.id, caret: b.text.length } : null });
}

// ---- 도형·표지·인쇄 설정 ----
export function addRect() {
  if (!get().project) return;
  const { pageId, place: c } = surface();
  const w = Math.min(60, c.w);
  const el: PageElement = { id: uid(), type: 'rect', x: c.x + (c.w - w) / 2, y: c.y + c.h / 2 - 20, w, h: 40, fill: '#7a8b72', opacity: 1 };
  mutate((p) => mapPage(p, pageId, (pg) => ({ ...pg, elements: [...pg.elements, el] })));
  set({ selection: [el.id], editingId: null, selectedBlock: null });
}

/** 템플릿으로 표지를 만든다. 이미 있으면 종이·날개 설정은 유지하고 디자인만 바꾼다. */
export function createCover(templateId: string) {
  mutate((p) => pruneAssets({ ...p, cover: makeCover(p, templateId, p.cover) }));
  set({ selection: [], editingId: null });
}

export function patchCover(patch: Partial<Cover>, key: string) {
  mutate((p) => (p.cover ? { ...p, cover: { ...p.cover, ...patch } } : p), { coalesce: `cover:${key}` });
}

export function patchPrint(patch: Partial<Project['print']>, key: string) {
  mutate((p) => ({ ...p, print: { ...p.print, ...patch } }), { coalesce: `print:${key}` });
}

export { bleedOf };

// ---- 레이어 ----
/** 요소를 한 단계 앞(위)이나 뒤(아래)로 옮긴다. */
export function moveElement(id: string, dir: 1 | -1) {
  const { pageId } = surface();
  mutate((p) => mapPage(p, pageId, (pg) => {
    const i = pg.elements.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= pg.elements.length) return pg;
    const elements = [...pg.elements];
    [elements[i], elements[j]] = [elements[j], elements[i]];
    return { ...pg, elements };
  }));
}

// ---- 내 템플릿·인쇄소 프로파일 (이 기기에 저장되어 다른 책에서도 쓴다) ----
export interface UserTemplate { id: string; name: string; styles: Project['styles']; master: Project['master']; margins: Project['margins']; baselineGrid?: boolean }
export interface ShopProfile { id: string; name: string; bleed: number; bindingType: Project['print']['bindingType']; profile?: Project['print']['profile']; paperId?: string; paperThickness?: number }

function readList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}
function writeList<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
    set({ libraryVersion: get().libraryVersion + 1 });
    return true;
  } catch {
    notify('저장하지 못했어요. 저장 공간이 부족할 수 있어요.', 'error');
    return false;
  }
}
export const userTemplates = () => readList<UserTemplate>('bs.templates');
export const shopProfiles = () => readList<ShopProfile>('bs.shops');

export function saveUserTemplate(name: string) {
  const p = get().project;
  if (!p?.styles || !name.trim()) return;
  const t: UserTemplate = { id: uid(), name: name.trim(), styles: p.styles, master: p.master, margins: p.margins, baselineGrid: p.baselineGrid };
  if (writeList('bs.templates', [...userTemplates(), t])) notify(`‘${t.name}’ 템플릿을 저장했어요. 다른 책에서도 쓸 수 있어요.`);
}
export function applyUserTemplate(id: string) {
  const t = userTemplates().find((x) => x.id === id);
  if (t) mutate((p) => ({ ...p, styles: structuredClone(t.styles), master: structuredClone(t.master), baselineGrid: t.baselineGrid, templateId: t.id }));
}
export const deleteUserTemplate = (id: string) => writeList('bs.templates', userTemplates().filter((x) => x.id !== id));

export function saveShopProfile(name: string) {
  const p = get().project;
  if (!p || !name.trim()) return;
  const sp: ShopProfile = { id: uid(), name: name.trim(), bleed: bleedOf(p), bindingType: p.print.bindingType, profile: p.print.profile, paperId: p.cover?.paperId, paperThickness: p.cover?.paperThickness };
  if (writeList('bs.shops', [...shopProfiles(), sp])) notify(`인쇄소 설정 ‘${sp.name}’을(를) 저장했어요.`);
}
export function applyShopProfile(id: string) {
  const sp = shopProfiles().find((x) => x.id === id);
  if (!sp) return;
  mutate((p) => ({
    ...p, print: { ...p.print, bleed: sp.bleed, bindingType: sp.bindingType, profile: sp.profile },
    cover: p.cover && sp.paperId ? { ...p.cover, paperId: sp.paperId, paperThickness: sp.paperThickness ?? p.cover.paperThickness } : p.cover,
  }));
  notify(`‘${sp.name}’ 설정을 적용했어요.`);
}
export const deleteShopProfile = (id: string) => writeList('bs.shops', shopProfiles().filter((x) => x.id !== id));
