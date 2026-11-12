// 자동 조판: 원고(문단 목록)를 본문 쪽에 흘려 넣고, 쪽 번호·머리말·목차를 계산한다.
// 결과는 화면(SVG)과 PDF가 그대로 그리는 "배치된 글줄" 목록이다.
import { contentRect, isRightHand } from '../model/factory';
import type { Block, ParaStyle, Project, Rect, StyleName, TextStyle } from '../model/types';
import { fontsVersion, resolveFont, type LoadedFont } from './fonts';
import { layoutText, plainText, type Line, type TextLayout } from './layout';
import { boldOf } from './render';
import { PT_TO_MM } from './units';

/** 한 쪽에 놓인 문단 조각 (문단이 쪽을 넘어가면 여러 조각으로 나뉜다) */
export interface Fragment {
  block: Block;
  /** 본문 영역 위쪽 기준 mm */
  y: number;
  h: number;
  x: number;
  w: number;
  lines: Line[];
  font: LoadedFont;
  fontBold?: LoadedFont;
  style: ParaStyle;
}

/** 쪽 아래에 놓이는 각주 */
export interface Note { n: number; text: string }

export interface Pagination {
  pages: Fragment[][];
  /** 쪽별 각주 */
  notes: Note[][];
  /** 문단이 시작하는 본문 쪽(0부터) */
  blockPage: Map<string, number>;
  missingFonts: Set<string>;
}

export interface PlacedText {
  key: string;
  /** 쪽 기준 mm */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: Line[];
  font: LoadedFont;
  fontBold?: LoadedFont;
  /** pt */
  fontSize: number;
  color: string;
  blockId?: string;
}

export interface PlacedImage {
  key: string;
  assetId: string;
  rect: Rect;
  blockId: string;
}

export interface TocEntry {
  blockId: string;
  level: 0 | 1;
  text: string;
  label: string;
}

export interface Derived {
  pagination: Pagination | null;
  /** 쪽 → 본문 쪽 순번(-1이면 본문 쪽이 아님) */
  flowIndex: number[];
  tocIndex: number[];
  /** 쪽 번호 표기('' = 번호 없음) */
  labels: string[];
  toc: TocEntry[];
  tocPagesNeeded: number;
  flowPagesNeeded: number;
}

const blockLayouts = new WeakMap<Block, { style: ParaStyle; w: number; fv: number; layout: TextLayout; font: LoadedFont; fontBold?: LoadedFont; missing: boolean }>();
const IMAGE_GAP = 4;
const HEADINGS: StyleName[] = ['chapter', 'section'];

/** 문단 단위 조판 캐시: 글이나 스타일이 바뀐 문단만 다시 조판한다. */
function layoutBlock(block: Block, style: ParaStyle, w: number) {
  const fv = fontsVersion();
  const hit = blockLayouts.get(block);
  if (hit && hit.style === style && hit.w === w && hit.fv === fv) return hit;
  const { font, missing } = resolveFont(style.fontFamily, style.bold);
  const fontBold = boldOf(style.fontFamily, font!);
  const layout = layoutText(block.text, { ...style, paraSpacing: 0 }, w, Infinity, { regular: font!, bold: fontBold }, { markup: true });
  const r = { style, w, fv, layout, font: font!, fontBold, missing };
  blockLayouts.set(block, r);
  return r;
}

const NOTE_GAP = 3; // 본문과 각주 사이 mm
export const noteStyle = (body: ParaStyle): TextStyle => ({ ...body, fontSize: Math.max(6, body.fontSize * 0.8), lineHeight: 1.5, indent: 0, paraSpacing: 0 });
const noteCache = new Map<string, TextLayout>();

/** 각주 한 개를 조판한다(번호 포함). */
export function layoutNote(note: Note, body: ParaStyle, w: number): { layout: TextLayout; font: LoadedFont; style: TextStyle } {
  const style = noteStyle(body);
  const { font } = resolveFont(style.fontFamily, style.bold);
  const key = `${fontsVersion()}|${style.fontFamily}|${style.fontSize}|${style.align}|${w}|${note.n}|${note.text}`;
  let layout = noteCache.get(key);
  if (!layout) {
    if (noteCache.size > 2000) noteCache.clear();
    layout = layoutText(`${note.n} ${note.text}`, style, w, Infinity, font!);
    noteCache.set(key, layout);
  }
  return { layout, font: font!, style };
}

export function paginate(
  story: Block[],
  styles: Record<StyleName, ParaStyle>,
  frameW: number,
  frameH: number,
  imageSize: (assetId: string) => { w: number; h: number } | undefined,
  opts: { grid?: boolean; continuousNotes?: boolean } = {},
): Pagination {
  const pages: Fragment[][] = [];
  const notes: Note[][] = [];
  let pageNotes: Note[] = [];
  let notesH = 0; // 이 쪽 각주가 차지하는 높이(간격 포함)
  let noteNo = 0; // 책 전체에 이어 매길 때의 각주 번호
  const blockPage = new Map<string, number>();
  const missingFonts = new Set<string>();
  let page: Fragment[] = [];
  let y = 0;
  const eps = 0.01;
  const newPage = () => {
    pages.push(page);
    notes.push(pageNotes);
    page = [];
    pageNotes = [];
    notesH = 0;
    y = 0;
  };
  const bodyLineH = styles.body.fontSize * PT_TO_MM * styles.body.lineHeight;

  for (const block of story) {
    const style = styles[block.style] ?? styles.body;
    if ((style.breakBefore || block.breakBefore) && page.length) newPage();

    if (block.assetId) {
      const size = imageSize(block.assetId);
      if (!size) continue;
      let w = frameW;
      let h = (w * size.h) / size.w;
      if (h > frameH) {
        h = frameH;
        w = (h * size.w) / size.h;
      }
      if (y + h > frameH + eps && page.length) newPage();
      const { font } = resolveFont(style.fontFamily, style.bold);
      blockPage.set(block.id, pages.length);
      page.push({ block, y, h, x: (frameW - w) / 2, w, lines: [], font: font!, style });
      y += h + IMAGE_GAP;
      continue;
    }

    const w = Math.max(10, frameW - style.inset * 2);
    const { layout, font, fontBold, missing } = layoutBlock(block, style, w);
    if (missing) missingFonts.add(style.fontFamily);
    const lineH = layout.fontSizeMm * style.lineHeight;
    const lines = layout.lines;
    const isHeading = HEADINGS.includes(block.style);
    let start = 0;

    while (start < lines.length) {
      let before = y === 0 ? (style.breakBefore && start === 0 ? style.spaceBefore : 0) : start === 0 ? style.spaceBefore : 0;
      // 기준선 격자: 본문 문단의 첫 줄을 본문 줄 높이의 배수 자리에 맞춘다
      if (opts.grid && !isHeading && start === 0) before = Math.ceil((y + before - eps) / bodyLineH) * bodyLineH - y;
      const left = lines.length - start;
      // 각주가 있는 줄은 각주가 같은 쪽 아래에 들어갈 자리까지 함께 따진다
      let fit = 0;
      let addH = 0;
      let count = opts.continuousNotes ? noteNo : pageNotes.length;
      for (; fit < left; fit++) {
        let h = 0;
        for (const idx of lines[start + fit].notes ?? []) h += layoutNote({ n: ++count, text: layout.notes[idx] }, styles.body, frameW).layout.fullHeight;
        const total = notesH + addH + h;
        if (y + before + (fit + 1) * lineH + (total ? total + (notesH ? 0 : NOTE_GAP) : 0) > frameH + eps) break;
        addH += h;
      }
      let take: number;
      if (fit >= left) {
        take = left;
        // 제목이 쪽 맨 아래에 홀로 남지 않도록, 뒤에 본문 두 줄이 들어갈 자리가 없으면 다음 쪽으로 넘긴다
        if (isHeading && page.length && frameH - y - before - left * lineH - style.spaceAfter < bodyLineH * 2) take = 0;
      } else if (isHeading) {
        take = 0; // 제목은 쪽을 넘겨 나누지 않는다
      } else {
        take = fit;
        if (left - take < 2) take = left - 2; // 다음 쪽 첫머리에 한 줄만 남기지 않는다
        if (take < 2) take = 0; // 쪽 끝에 문단 첫 줄만 남기지 않는다
      }
      if (take <= 0) {
        if (page.length) {
          newPage();
          continue;
        }
        take = Math.max(1, Math.min(fit, left)); // 빈 쪽에도 안 들어가면 강제로 넣는다
      }
      const top0 = lines[start].top;
      if (start === 0) blockPage.set(block.id, pages.length);
      const slice = lines.slice(start, start + take);
      const hasNotes = slice.some((l) => l.notes);
      const fragLines = top0 === 0 && !hasNotes ? (take === lines.length ? lines : slice) : slice.map((l) => {
        const moved = { ...l, top: l.top - top0, baseline: l.baseline - top0 };
        if (!l.notes) return moved;
        // 각주 번호는 쪽마다 1부터 매긴다
        moved.runs = l.runs.map((r) => {
          if (r.fn === undefined) return r;
          const note = { n: opts.continuousNotes ? ++noteNo : pageNotes.length + 1, text: layout.notes[r.fn] };
          if (!pageNotes.length) notesH += NOTE_GAP;
          pageNotes.push(note);
          notesH += layoutNote(note, styles.body, frameW).layout.fullHeight;
          return { ...r, text: String(note.n) };
        });
        return moved;
      });
      page.push({ block, y: y + before, h: take * lineH, x: style.inset, w, font, fontBold, style, lines: fragLines });
      y += before + take * lineH;
      start += take;
      if (start < lines.length) newPage();
      else y += style.spaceAfter;
    }
  }
  if (page.length || !pages.length) {
    pages.push(page);
    notes.push(pageNotes);
  }
  return { pages, notes, blockPage, missingFonts };
}

function roman(n: number): string {
  if (n <= 0) return String(n);
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

let lastPagination: { story: Block[]; styles: unknown; w: number; h: number; fv: number; assets: unknown; grid: number; result: Pagination } | null = null;
const flowMode = (p: Project) => (p.baselineGrid ? 1 : 0) + (p.footnoteNumbering === 'book' ? 2 : 0);
const derivedCache = new WeakMap<Project, Derived>();

/** 원고에서 파생되는 정보(쪽 나눔, 쪽 번호, 목차)를 계산한다. */
export function derive(project: Project): Derived {
  const hit = derivedCache.get(project);
  if (hit) return hit;
  const { story, styles } = project;
  let pagination: Pagination | null = null;
  if (story && styles) {
    const c = contentRect(project, 0);
    const fv = fontsVersion();
    const lp = lastPagination;
    if (lp && lp.story === story && lp.styles === styles && lp.w === c.w && lp.h === c.h && lp.fv === fv && lp.assets === project.assets && lp.grid === flowMode(project)) {
      pagination = lp.result;
    } else {
      pagination = paginate(story, styles, c.w, c.h, (id) => {
        const a = project.assets[id];
        return a && { w: a.pxW, h: a.pxH };
      }, { grid: project.baselineGrid, continuousNotes: project.footnoteNumbering === 'book' });
      lastPagination = { story, styles, w: c.w, h: c.h, fv, assets: project.assets, grid: flowMode(project), result: pagination };
    }
  }

  const flowIndex: number[] = [];
  const tocIndex: number[] = [];
  const flowToPage: number[] = [];
  let f = 0;
  let t = 0;
  project.pages.forEach((p, i) => {
    flowIndex.push(p.kind === 'flow' ? f++ : -1);
    tocIndex.push(p.kind === 'toc' ? t++ : -1);
    if (p.kind === 'flow') flowToPage.push(i);
  });

  const pn = project.master?.pageNumber;
  let counter = pn ? pn.startAt - 1 : 0;
  const labels = project.pages.map((_, i) => {
    if (!pn || i < pn.firstPage - 1) return '';
    // 장별 쪽 번호: 장이 시작하는 쪽에서 번호를 다시 시작한다
    const opens = pn.restartPerChapter && flowIndex[i] >= 0 && pagination?.pages[flowIndex[i]]?.[0]?.block.style === 'chapter';
    counter = opens ? pn.startAt : counter + 1;
    return pn.format === 'roman' ? roman(counter) : String(counter);
  });

  const toc: TocEntry[] = [];
  if (story && pagination) {
    for (const b of story) {
      if (b.assetId || !b.text.trim()) continue;
      if (b.style !== 'chapter' && !(b.style === 'section' && (project.toc?.includeSections ?? true))) continue;
      const pageIdx = flowToPage[pagination.blockPage.get(b.id) ?? -1];
      toc.push({ blockId: b.id, level: b.style === 'chapter' ? 0 : 1, text: plainText(b.text), label: pageIdx === undefined ? '' : labels[pageIdx] });
    }
  }
  const { perFirst, perNext } = tocCapacity(project);
  const tocPagesNeeded = toc.length <= perFirst ? 1 : 1 + Math.ceil((toc.length - perFirst) / perNext);

  const d: Derived = { pagination, flowIndex, tocIndex, labels, toc, tocPagesNeeded, flowPagesNeeded: pagination ? pagination.pages.length : 0 };
  derivedCache.set(project, d);
  return d;
}

// ---- 목차 ----
function tocMetrics(project: Project) {
  const body = project.styles!.body;
  const chapter = project.styles!.chapter;
  const entryStyle: TextStyle = { ...body, align: 'left', indent: 0, lineHeight: 1, letterSpacing: 0 };
  const lineH = body.fontSize * PT_TO_MM * 2.1;
  const titleStyle: TextStyle = { ...chapter, fontSize: Math.min(chapter.fontSize, 15) };
  const titleH = titleStyle.fontSize * PT_TO_MM * titleStyle.lineHeight + 14;
  return { entryStyle, lineH, titleStyle, titleH };
}

function tocCapacity(project: Project) {
  if (!project.styles) return { perFirst: 1, perNext: 1 };
  const c = contentRect(project, 0);
  const { lineH, titleH } = tocMetrics(project);
  return {
    perFirst: Math.max(1, Math.floor((c.h - titleH - 12) / lineH)),
    perNext: Math.max(1, Math.floor(c.h / lineH)),
  };
}

/** 한 줄짜리 글을 지정한 정렬로 놓는다. */
function placeLine(key: string, text: string, style: TextStyle, x: number, y: number, w: number): PlacedText | null {
  const { font } = resolveFont(style.fontFamily, style.bold);
  if (!font || !text) return null;
  const one = layoutText(text.replace(/\n/g, ' '), { ...style, indent: 0, paraSpacing: 0, align: style.align === 'justify' ? 'left' : style.align }, w, Infinity, font);
  const lines = one.lines.slice(0, 1);
  return { key, x, y, w, h: one.fontSizeMm * style.lineHeight, lines, font, fontSize: style.fontSize, color: style.color };
}

const textWidth = (text: string, font: LoadedFont, sizeMm: number) =>
  Array.from(text).reduce((s, ch) => s + font.adv(ch.codePointAt(0)!) * sizeMm, 0);

function tocTexts(project: Project, d: Derived, pageIndex: number): PlacedText[] {
  const out: PlacedText[] = [];
  const c = contentRect(project, pageIndex);
  const { entryStyle, lineH, titleStyle, titleH } = tocMetrics(project);
  const { perFirst, perNext } = tocCapacity(project);
  const k = d.tocIndex[pageIndex];
  const start = k === 0 ? 0 : perFirst + (k - 1) * perNext;
  const entries = d.toc.slice(start, start + (k === 0 ? perFirst : perNext));
  let y = c.y;
  if (k === 0) {
    const title = placeLine('toc-title', project.toc?.title || '차례', titleStyle, c.x, c.y + 6, c.w);
    if (title) out.push(title);
    y += titleH + 6;
  }
  const size = entryStyle.fontSize * PT_TO_MM;
  // 점선이 같은 자리에서 끝나도록 가장 넓은 쪽 번호에 맞춘다
  const plainFont = resolveFont(entryStyle.fontFamily, false).font;
  const maxNumW = plainFont ? Math.max(0, ...entries.map((e) => textWidth(e.label, plainFont, size))) : 0;
  entries.forEach((e, i) => {
    const style: TextStyle = { ...entryStyle, bold: e.level === 0 };
    const { font } = resolveFont(style.fontFamily, style.bold);
    const plain = resolveFont(style.fontFamily, false).font;
    if (!font || !plain) return;
    const indent = e.level * 5;
    const numW = textWidth(e.label, plain, size);
    const maxTitleW = c.w - indent - maxNumW - 8;
    let title = e.text;
    if (textWidth(title, font, size) > maxTitleW) {
      const chars = Array.from(title);
      while (chars.length > 1 && textWidth(chars.join('') + '…', font, size) > maxTitleW) chars.pop();
      title = chars.join('') + '…';
    }
    const titleW = textWidth(title, font, size);
    const baseline = (lineH - (font.ascent + font.descent) * size) / 2 + font.ascent * size;
    const rowY = y + i * lineH;
    out.push({
      key: `toc-${e.blockId}`, x: c.x, y: rowY, w: c.w, h: lineH, font, fontSize: style.fontSize, color: style.color, blockId: e.blockId,
      lines: [{ runs: [{ text: title, x: indent, ls: 0 }], baseline, top: 0, width: c.w }],
    });
    const runs = [];
    if (project.toc?.leader ?? true) {
      const dot = plain.adv(0xb7) > 0 && plain.has(0xb7) ? '·' : '.';
      const dotW = plain.adv(dot.codePointAt(0)!) * size;
      const gap = c.w - indent - titleW - maxNumW - 5;
      const n = Math.floor(gap / (dotW * 1.6));
      if (n > 2) {
        const ls = dotW * 0.6;
        const dotsW = n * dotW + (n - 1) * ls;
        runs.push({ text: dot.repeat(n), x: c.w - maxNumW - 2.5 - dotsW, ls });
      }
    }
    if (e.label) runs.push({ text: e.label, x: c.w - numW, ls: 0 });
    if (runs.length) {
      out.push({
        key: `toc-n-${e.blockId}`, x: c.x, y: rowY, w: c.w, h: lineH, font: plain, fontSize: style.fontSize, color: style.color,
        lines: [{ runs, baseline, top: 0, width: c.w }],
      });
    }
  });
  return out;
}

// ---- 공통 요소(마스터) ----
function masterTexts(project: Project, d: Derived, pageIndex: number): PlacedText[] {
  const m = project.master;
  const page = project.pages[pageIndex];
  if (!m || page.hideMaster) return [];
  const out: PlacedText[] = [];
  const c = contentRect(project, pageIndex);
  const right = isRightHand(project, pageIndex);
  const outside: TextStyle['align'] = right ? 'right' : 'left';
  const base: TextStyle = {
    fontFamily: m.fontFamily, bold: false, fontSize: m.fontSize, lineHeight: 1.2, letterSpacing: 0, align: 'left',
    color: m.color, paraSpacing: 0, indent: 0, wordBreak: 'word',
  };
  const lineH = m.fontSize * PT_TO_MM * 1.2;

  const label = d.labels[pageIndex];
  if (m.pageNumber.show && label) {
    const y = project.format.height - project.margins.bottom / 2 - lineH / 2;
    const t = placeLine('pn', label, { ...base, align: m.pageNumber.position === 'bottom-center' ? 'center' : outside }, c.x, y, c.w);
    if (t) out.push(t);
  }

  const fi = d.flowIndex[pageIndex];
  if (m.header.show && fi >= 0 && d.pagination) {
    const frags = d.pagination.pages[fi] ?? [];
    const opensChapter = frags[0]?.block.style === 'chapter';
    const which = right ? m.header.right : m.header.left;
    if (!opensChapter && frags.length && which !== 'none') {
      let text = which === 'title' ? project.meta.title : which === 'author' ? project.meta.author : '';
      if (which === 'chapter') {
        // 이 쪽까지 나온 마지막 장 제목
        for (const b of project.story!) {
          if (b.style !== 'chapter') continue;
          if ((d.pagination.blockPage.get(b.id) ?? Infinity) > fi) break;
          text = b.text;
        }
      }
      const y = Math.max(3, project.margins.top / 2 - lineH / 2);
      const t = placeLine('hd', plainText(text), { ...base, align: outside }, c.x, y, c.w);
      if (t) out.push(t);
    }
  }
  return out;
}

export interface DerivedPage { texts: PlacedText[]; images: PlacedImage[]; rules: Rect[] }
const pageCache = new WeakMap<Project, Map<number, DerivedPage>>();

const UNNUMBERED = /^(프롤로그|에필로그|들어가|나가며|나오는|머리말|맺음말|맺는|서문|후기|작가의|차례|prologue|epilogue)/i;
const chapterNoCache = new WeakMap<Block[], Map<string, number>>();
/** 장 번호: 프롤로그·에필로그 같은 장은 세지 않는다. */
function chapterNumbers(story: Block[]): Map<string, number> {
  let map = chapterNoCache.get(story);
  if (!map) {
    map = new Map();
    let n = 0;
    for (const b of story) if (b.style === 'chapter' && !b.assetId && !UNNUMBERED.test(plainText(b.text))) map.set(b.id, ++n);
    chapterNoCache.set(story, map);
  }
  return map;
}

/** 한 쪽에 자동으로 놓이는 내용(본문 흐름, 목차, 쪽 번호, 머리말) */
export function derivedContent(project: Project, pageIndex: number): DerivedPage {
  let map = pageCache.get(project);
  if (!map) pageCache.set(project, (map = new Map()));
  const hit = map.get(pageIndex);
  if (hit) return hit;

  const texts: PlacedText[] = [];
  const images: PlacedImage[] = [];
  const rules: Rect[] = [];
  const page = project.pages[pageIndex];
  if (page && project.styles) {
    const d = derive(project);
    const c = contentRect(project, pageIndex);
    const fi = d.flowIndex[pageIndex];
    if (fi >= 0 && d.pagination) {
      (d.pagination.pages[fi] ?? []).forEach((fr, i) => {
        if (fr.block.assetId) {
          images.push({ key: `${fr.block.id}-${i}`, assetId: fr.block.assetId, blockId: fr.block.id, rect: { x: c.x + fr.x, y: c.y + fr.y, w: fr.w, h: fr.h } });
        } else {
          texts.push({
            key: `${fr.block.id}-${i}`, x: c.x + fr.x, y: c.y + fr.y, w: fr.w, h: fr.h, lines: fr.lines, font: fr.font,
            fontBold: fr.fontBold, fontSize: fr.style.fontSize, color: fr.style.color, blockId: fr.block.id,
          });
        }
      });
      // 장 시작 쪽 꾸밈
      if (project.chapterOpener) {
        for (const fr of d.pagination.pages[fi] ?? []) {
          if (fr.block.style !== 'chapter' || fr.block.assetId || d.pagination.blockPage.get(fr.block.id) !== fi) continue;
          const st = fr.style;
          const at = (w: number) => c.x + fr.x + (st.align === 'center' ? (fr.w - w) / 2 : st.align === 'right' ? fr.w - w : 0);
          if (project.chapterOpener === 'rule') rules.push({ x: at(14), y: c.y + fr.y + fr.h + 4, w: 14, h: 0.3 });
          else {
            const n = chapterNumbers(project.story!).get(fr.block.id);
            const size = st.fontSize * 2.4;
            const num = n && placeLine(`ch-${fr.block.id}`, String(n), { ...st, bold: false, fontSize: size, lineHeight: 1, color: '#b9b2a6' }, c.x + fr.x, c.y + fr.y - size * PT_TO_MM - 3, fr.w);
            if (num && num.y > 2) texts.push(num);
          }
        }
      }
      // 각주: 본문 영역 맨 아래에 쌓고, 위에 짧은 구분선을 긋는다
      const pageNotes = d.pagination.notes[fi] ?? [];
      if (pageNotes.length) {
        const laid = pageNotes.map((n) => layoutNote(n, project.styles!.body, c.w));
        let y = c.y + c.h - laid.reduce((sum, l) => sum + l.layout.fullHeight, 0);
        rules.push({ x: c.x, y: y - 1.5, w: Math.min(30, c.w / 3), h: 0.12 });
        laid.forEach((l, i) => {
          texts.push({ key: `note-${i}`, x: c.x, y, w: c.w, h: l.layout.fullHeight, lines: l.layout.lines, font: l.font, fontSize: l.style.fontSize, color: l.style.color });
          y += l.layout.fullHeight;
        });
      }
    }
    if (d.tocIndex[pageIndex] >= 0) texts.push(...tocTexts(project, d, pageIndex));
    texts.push(...masterTexts(project, d, pageIndex));
  }
  const r = { texts, images, rules };
  map.set(pageIndex, r);
  return r;
}

/**
 * 원고 분량에 맞게 본문 쪽과 목차 쪽의 수를 맞춘다.
 * 모자라면 마지막 본문(목차) 쪽 뒤에 추가하고, 남으면 뒤에서부터 지운다.
 * 사용자가 요소를 올려 둔 쪽은 지우지 않는다.
 */
export function syncPages(project: Project, newId: () => string): Project {
  if (!project.story || !project.styles) return project;
  let pages = project.pages;
  const adjust = (kind: 'flow' | 'toc', needed: number) => {
    const idx = pages.map((p, i) => (p.kind === kind ? i : -1)).filter((i) => i >= 0);
    if (kind === 'toc' && !idx.length) return;
    if (idx.length < needed) {
      const at = idx.length ? idx[idx.length - 1] + 1 : pages.length;
      const add = Array.from({ length: needed - idx.length }, () => ({ id: newId(), kind, elements: [] }));
      pages = [...pages.slice(0, at), ...add, ...pages.slice(at)];
    } else if (idx.length > needed) {
      const drop = new Set<number>();
      for (let k = idx.length - 1; k >= needed; k--) {
        if (pages[idx[k]].elements.length) break;
        drop.add(idx[k]);
      }
      if (drop.size) pages = pages.filter((_, i) => !drop.has(i));
    }
  };
  // 목차 쪽 수는 쪽 번호와 무관하게 항목 수로만 정해지므로 한 번에 맞출 수 있다
  const d = derive(project);
  adjust('flow', Math.max(1, d.flowPagesNeeded));
  adjust('toc', d.tocPagesNeeded);
  return pages === project.pages ? project : { ...project, pages };
}
