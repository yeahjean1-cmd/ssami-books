// 자동 조판: 원고(문단 목록)를 본문 쪽에 흘려 넣고, 쪽 번호·머리말·목차를 계산한다.
// 결과는 화면(SVG)과 PDF가 그대로 그리는 "배치된 글줄" 목록이다.
import { contentRect, isRightHand } from '../model/factory';
import type { Block, ParaStyle, Project, Rect, StyleName, TextStyle } from '../model/types';
import { fontsVersion, resolveFont, type LoadedFont } from './fonts';
import { layoutText, type Line, type TextLayout } from './layout';
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
  style: ParaStyle;
}

export interface Pagination {
  pages: Fragment[][];
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

const blockLayouts = new WeakMap<Block, { style: ParaStyle; w: number; fv: number; layout: TextLayout; font: LoadedFont; missing: boolean }>();
const IMAGE_GAP = 4;
const HEADINGS: StyleName[] = ['chapter', 'section'];

/** 문단 단위 조판 캐시: 글이나 스타일이 바뀐 문단만 다시 조판한다. */
function layoutBlock(block: Block, style: ParaStyle, w: number) {
  const fv = fontsVersion();
  const hit = blockLayouts.get(block);
  if (hit && hit.style === style && hit.w === w && hit.fv === fv) return hit;
  const { font, missing } = resolveFont(style.fontFamily, style.bold);
  const layout = layoutText(block.text, { ...style, paraSpacing: 0 }, w, Infinity, font!);
  const r = { style, w, fv, layout, font: font!, missing };
  blockLayouts.set(block, r);
  return r;
}

export function paginate(
  story: Block[],
  styles: Record<StyleName, ParaStyle>,
  frameW: number,
  frameH: number,
  imageSize: (assetId: string) => { w: number; h: number } | undefined,
): Pagination {
  const pages: Fragment[][] = [];
  const blockPage = new Map<string, number>();
  const missingFonts = new Set<string>();
  let page: Fragment[] = [];
  let y = 0;
  const eps = 0.01;
  const newPage = () => {
    pages.push(page);
    page = [];
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
    const { layout, font, missing } = layoutBlock(block, style, w);
    if (missing) missingFonts.add(style.fontFamily);
    const lineH = layout.fontSizeMm * style.lineHeight;
    const lines = layout.lines;
    const isHeading = HEADINGS.includes(block.style);
    let start = 0;

    while (start < lines.length) {
      const before = y === 0 ? (style.breakBefore && start === 0 ? style.spaceBefore : 0) : start === 0 ? style.spaceBefore : 0;
      const left = lines.length - start;
      const fit = Math.floor((frameH - y - before + eps) / lineH);
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
      page.push({
        block, y: y + before, h: take * lineH, x: style.inset, w, font, style,
        lines: start === 0 && take === lines.length ? lines : lines.slice(start, start + take).map((l) => ({ ...l, top: l.top - top0, baseline: l.baseline - top0 })),
      });
      y += before + take * lineH;
      start += take;
      if (start < lines.length) newPage();
      else y += style.spaceAfter;
    }
  }
  if (page.length || !pages.length) pages.push(page);
  return { pages, blockPage, missingFonts };
}

function roman(n: number): string {
  if (n <= 0) return String(n);
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

let lastPagination: { story: Block[]; styles: unknown; w: number; h: number; fv: number; assets: unknown; result: Pagination } | null = null;
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
    if (lp && lp.story === story && lp.styles === styles && lp.w === c.w && lp.h === c.h && lp.fv === fv && lp.assets === project.assets) {
      pagination = lp.result;
    } else {
      pagination = paginate(story, styles, c.w, c.h, (id) => {
        const a = project.assets[id];
        return a && { w: a.pxW, h: a.pxH };
      });
      lastPagination = { story, styles, w: c.w, h: c.h, fv, assets: project.assets, result: pagination };
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
  const labels = project.pages.map((_, i) => {
    if (!pn || i < pn.firstPage - 1) return '';
    const n = i - (pn.firstPage - 1) + pn.startAt;
    return pn.format === 'roman' ? roman(n) : String(n);
  });

  const toc: TocEntry[] = [];
  if (story && pagination) {
    for (const b of story) {
      if (b.assetId || !b.text.trim()) continue;
      if (b.style !== 'chapter' && !(b.style === 'section' && (project.toc?.includeSections ?? true))) continue;
      const pageIdx = flowToPage[pagination.blockPage.get(b.id) ?? -1];
      toc.push({ blockId: b.id, level: b.style === 'chapter' ? 0 : 1, text: b.text.replace(/\s+/g, ' ').trim(), label: pageIdx === undefined ? '' : labels[pageIdx] });
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
      const t = placeLine('hd', text.replace(/\s+/g, ' ').trim(), { ...base, align: outside }, c.x, y, c.w);
      if (t) out.push(t);
    }
  }
  return out;
}

const pageCache = new WeakMap<Project, Map<number, { texts: PlacedText[]; images: PlacedImage[] }>>();

/** 한 쪽에 자동으로 놓이는 내용(본문 흐름, 목차, 쪽 번호, 머리말) */
export function derivedContent(project: Project, pageIndex: number): { texts: PlacedText[]; images: PlacedImage[] } {
  let map = pageCache.get(project);
  if (!map) pageCache.set(project, (map = new Map()));
  const hit = map.get(pageIndex);
  if (hit) return hit;

  const texts: PlacedText[] = [];
  const images: PlacedImage[] = [];
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
            fontSize: fr.style.fontSize, color: fr.style.color, blockId: fr.block.id,
          });
        }
      });
    }
    if (d.tocIndex[pageIndex] >= 0) texts.push(...tocTexts(project, d, pageIndex));
    texts.push(...masterTexts(project, d, pageIndex));
  }
  const r = { texts, images };
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
