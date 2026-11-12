// 표지 좌표 계산: 책등 너비, 표지 펼침 크기, 저장 좌표 ↔ 화면 좌표 변환, 표지 템플릿
import { uid } from './factory';
import type { Cover, PageElement, Project, Rect, TextStyle } from './types';

export interface PaperPreset { id: string; name: string; thickness: number }

/** 내지 종이 한 장 두께(mm). 제조사·생산 시기에 따라 다르므로 참고값이다. */
export const PAPERS: PaperPreset[] = [
  { id: 'mojo80', name: '미색/백색 모조지 80g', thickness: 0.1 },
  { id: 'mojo100', name: '미색/백색 모조지 100g', thickness: 0.12 },
  { id: 'mojo120', name: '미색/백색 모조지 120g', thickness: 0.145 },
  { id: 'elight80', name: '이라이트 80g (가볍고 두꺼운 종이)', thickness: 0.13 },
  { id: 'snow100', name: '스노우지 100g', thickness: 0.09 },
  { id: 'snow120', name: '스노우지 120g', thickness: 0.11 },
  { id: 'art100', name: '아트지 100g', thickness: 0.08 },
  { id: 'custom', name: '직접 입력', thickness: 0.1 },
];

export const DEFAULT_BLEED = 3;
export const SAFE = 3;
export const bleedOf = (p: Project) => p.print.bleed ?? DEFAULT_BLEED;

/** 책등 너비 계산값: 내지 장수 × 종이 두께. 중철은 책등이 없다. */
export function computedSpine(project: Project): number {
  if (project.print.bindingType === 'saddle' || !project.cover) return 0;
  const sheets = Math.ceil(project.pages.length / (project.print.duplex ? 2 : 1));
  return Math.round(sheets * project.cover.paperThickness * 10) / 10;
}

export interface CoverGeom {
  width: number;
  height: number;
  flap: number;
  spine: number;
  /** 각 영역의 왼쪽 x */
  backX: number;
  spineX: number;
  frontX: number;
  pageW: number;
}

export function coverGeom(project: Project): CoverGeom {
  const c = project.cover;
  const pageW = project.format.width;
  const flap = c?.flap ?? 0;
  const spine = project.print.bindingType === 'saddle' ? 0 : c?.spineOverride ?? computedSpine(project);
  return {
    width: flap * 2 + pageW * 2 + spine, height: project.format.height, flap, spine, pageW,
    backX: flap, spineX: flap + pageW, frontX: flap + pageW + spine,
  };
}

/** 가로쓰기(좌철) 책은 앞표지가 오른쪽, 우철 책은 왼쪽에 온다. */
export const frontRect = (project: Project, g = coverGeom(project)): Rect =>
  ({ x: project.print.binding === 'left' ? g.frontX : g.backX, y: 0, w: g.pageW, h: g.height });
export const backRect = (project: Project, g = coverGeom(project)): Rect =>
  ({ x: project.print.binding === 'left' ? g.backX : g.frontX, y: 0, w: g.pageW, h: g.height });

/** 저장 좌표의 요소를 표지 펼침면 좌표로 옮긴다. */
export function toDisplay<T extends PageElement>(el: T, g: CoverGeom): T {
  if (el.spine) return { ...el, x: g.spineX + g.spine / 2 + el.x };
  if (el.x < 0 && el.x + el.w > 0) return { ...el, x: g.spineX + el.x, w: el.w + g.spine }; // 앞뒤 표지에 걸친 요소는 책등만큼 늘어난다
  return { ...el, x: (el.x < 0 ? g.spineX : g.frontX) + el.x };
}

/** 표지 펼침면 좌표의 요소를 저장 좌표로 되돌린다. 가운데가 책등 안에 있으면 책등 요소가 된다. */
export function fromDisplay<T extends PageElement>(el: T, g: CoverGeom): T {
  const cx = el.x + el.w / 2;
  const spineR = g.spineX + g.spine;
  // 돌린 요소(세로로 놓인 책등 제목 등)는 보이는 폭으로 판단한다
  const a = ((el.rotation ?? 0) * Math.PI) / 180;
  const hw = (Math.abs(el.w * Math.cos(a)) + Math.abs(el.h * Math.sin(a))) / 2;
  if (g.spine > 0 && !el.rotation && cx - hw < g.spineX && cx + hw > spineR && el.w > g.spine * 2) {
    return { ...el, spine: undefined, x: el.x - g.spineX, w: el.w - g.spine };
  }
  if (g.spine > 0 && cx >= g.spineX && cx <= spineR) return { ...el, spine: true, x: el.x - (g.spineX + g.spine / 2) };
  return { ...el, spine: undefined, x: cx < g.spineX ? el.x - g.spineX : el.x - g.frontX };
}

export const displayElements = (project: Project, g = coverGeom(project)) => (project.cover?.elements ?? []).map((e) => toDisplay(e, g));

/** 표지를 편집 캔버스·PDF가 다루는 "한 쪽짜리 문서"로 본다. */
export function coverAsProject(project: Project): Project {
  const g = coverGeom(project);
  return {
    ...project, story: undefined, styles: undefined, master: undefined,
    format: { ...project.format, width: g.width, height: g.height },
    margins: { top: 0, bottom: 0, inside: 0, outside: 0 },
    pages: [{ id: 'cover', kind: 'free', hideMaster: true, elements: displayElements(project, g) }],
  };
}

export interface CoverTemplate { id: string; name: string; hint: string; background: string; ink: string; band?: string; layout?: 'split' | 'frame' | 'left' }

export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: 'minimal', name: '미니멀', hint: '밝은 종이색, 명조 제목', background: '#f4efe6', ink: '#2b2a28' },
  { id: 'band', name: '색 띠', hint: '흰 바탕에 색 띠', background: '#ffffff', ink: '#2b2a28', band: '#7a8b72' },
  { id: 'dark', name: '짙은 바탕', hint: '차콜 바탕, 밝은 글자', background: '#2b2a28', ink: '#f4efe6' },
  { id: 'essay', name: '에세이', hint: '따뜻한 브라운 바탕', background: '#8b6f54', ink: '#fffaf2' },
  { id: 'split', name: '반반', hint: '위는 색 면, 아래는 제목', background: '#f6f2ea', ink: '#2b2a28', band: '#4d6a7a', layout: 'split' },
  { id: 'frame', name: '액자', hint: '가는 테두리 안에 제목', background: '#fbf8f1', ink: '#3a332b', band: '#8b6f54', layout: 'frame' },
  { id: 'left', name: '왼쪽 정렬', hint: '짧은 선과 왼쪽 정렬 제목', background: '#eef0ea', ink: '#26302a', band: '#26302a', layout: 'left' },
];

const text = (r: Rect, t: string, s: Partial<TextStyle>, extra: Partial<PageElement> = {}): PageElement => ({
  id: uid(), type: 'text', ...r, text: t, ...(extra as object),
  style: {
    fontFamily: 'Nanum Myeongjo', bold: false, fontSize: 10, lineHeight: 1.5, letterSpacing: 0, align: 'center', color: '#000000',
    paraSpacing: 0, indent: 0, wordBreak: 'word', ...s,
  },
});

/** 세로쓰기 책등 글: 글자를 한 줄에 하나씩 세워 쌓는다. x는 책등 가운데 기준. */
export function spineStacked(textValue: string, H: number, style: Partial<TextStyle>): PageElement {
  const size = style.fontSize ?? 9;
  const lineHeight = 1.12;
  const chars = Array.from(textValue.replace(/\n/g, ''));
  const w = size * 0.3528 * 1.7;
  const h = Math.min(H - 20, chars.length * size * 0.3528 * lineHeight + 1);
  return text({ x: -w / 2, y: (H - h) / 2, w, h }, chars.join('\n'), { ...style, fontSize: size, lineHeight, align: 'center' }, { spine: true });
}

/** 눕혀 쓰는 책등 글: 위에서 아래로 읽히도록 90도 돌린다. */
export function spineRotated(textValue: string, H: number, style: Partial<TextStyle>): PageElement {
  const len = H * 0.6;
  return text({ x: -len / 2, y: H / 2 - 3, w: len, h: 6 }, textValue.replace(/\n/g, ''), { ...style, lineHeight: 1.2, align: 'center' }, { rotation: 90, spine: true });
}

/** 책등의 글 요소를 세로쓰기 ↔ 눕혀 쓰기로 바꾼다. */
export function convertSpine(cover: Cover, H: number, vertical: boolean): Cover {
  return {
    ...cover,
    elements: cover.elements.map((el) => {
      if (!el.spine || el.type !== 'text') return el;
      const isVertical = !el.rotation;
      if (isVertical === vertical) return el;
      const made = vertical ? spineStacked(el.text, H, el.style) : spineRotated(el.text.replace(/\n\n/g, ' '), H, el.style);
      return { ...made, id: el.id };
    }),
  };
}

export const spineIsVertical = (cover: Cover) => cover.elements.some((el) => el.spine && el.type === 'text' && !el.rotation);

/** 템플릿으로 표지를 만든다. 모든 요소는 만든 뒤 자유롭게 고칠 수 있다. */
export function makeCover(project: Project, templateId: string, keep?: Cover): Cover {
  const t = COVER_TEMPLATES.find((x) => x.id === templateId) ?? COVER_TEMPLATES[0];
  const W = project.format.width;
  const H = project.format.height;
  const m = Math.max(12, W * 0.11);
  const leftBound = project.print.binding === 'left';
  // 저장 좌표: 앞표지는 좌철일 때 0..W, 우철일 때 -W..0
  const fx = leftBound ? 0 : -W;
  const bx = leftBound ? -W : 0;
  const { title, subtitle, author, publisher } = project.meta;
  const titleSize = Math.max(18, Math.round(W / 5.5));
  const titleH = titleSize * 0.3528 * 1.35 * 2;
  const over = 5; // 책 바깥쪽 재단선을 넘어 도련까지 채우는 여분
  const rect = (x: number, y: number, w: number, h: number, fill: string): PageElement => ({ id: uid(), type: 'rect', x, y, w, h, fill, opacity: 1 });
  /** 앞표지 가로 전체(책등 쪽 끝에서 바깥 도련까지)를 덮는 면 */
  const fullWidth = (y: number, h: number, fill: string) => rect(leftBound ? fx : fx - over, y, W + over, h, fill);
  const els: PageElement[] = [];
  let titleY = H * 0.22;
  let titleColor = t.ink;
  let align: TextStyle['align'] = 'center';
  let authorY = H * 0.58;

  if (t.layout === 'split') {
    els.push(fullWidth(-over, H * 0.52 + over, t.band!));
    titleY = H * 0.58;
    authorY = H * 0.58 + titleH + 8;
  } else if (t.layout === 'frame') {
    els.push(rect(fx + 8, 8, W - 16, H - 16, t.band!), rect(fx + 8.6, 8.6, W - 17.2, H - 17.2, t.background));
    titleY = H * 0.26;
  } else if (t.layout === 'left') {
    els.push(rect(fx + m, H * 0.2, 18, 1.2, t.band!));
    titleY = H * 0.2 + 7;
    authorY = titleY + titleH + 6;
    align = 'left';
  } else if (t.band) {
    els.push(fullWidth(H * 0.16, H * 0.3, t.band));
    titleColor = '#ffffff';
  }

  els.push(text({ x: fx + m, y: titleY, w: W - m * 2, h: titleH }, title, { fontSize: titleSize, bold: true, lineHeight: 1.35, color: titleColor, align }));
  if (subtitle && t.layout !== 'left' && t.layout !== 'split') {
    els.push(text({ x: fx + m, y: titleY + titleH + 3, w: W - m * 2, h: 8 }, subtitle, { fontSize: 10.5, color: titleColor, align }));
  }
  if (author) els.push(text({ x: fx + m, y: authorY, w: W - m * 2, h: 8 }, author, { fontSize: 12, color: t.ink, align }));
  if (publisher) els.push(text({ x: fx + m, y: H - m - 6, w: W - m * 2, h: 6 }, publisher, { fontFamily: 'Pretendard', fontSize: 9, color: t.ink, align }));
  els.push(text({ x: bx + m, y: H * 0.3, w: W - m * 2, h: 40 }, '뒤표지에 넣을 책 소개 글을 써 보세요.', { fontSize: 9.5, lineHeight: 1.8, align: 'left', wordBreak: 'char', color: t.ink }));
  // 책등 제목: 우리말 책의 관례대로 세로쓰기로 넣는다. 표지 설정에서 눕혀 쓰기로 바꿀 수 있다.
  els.push(spineStacked([title, author].filter(Boolean).join('  '), H, { fontSize: 9, color: t.ink, bold: true }));
  return {
    background: t.background, elements: els, flap: keep?.flap ?? 0,
    paperId: keep?.paperId ?? 'mojo80', paperThickness: keep?.paperThickness ?? 0.1, spineOverride: keep?.spineOverride,
  };
}
