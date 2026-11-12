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

export interface CoverTemplate { id: string; name: string; hint: string; background: string; ink: string; band?: string }

export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: 'minimal', name: '미니멀', hint: '밝은 종이색, 명조 제목', background: '#f4efe6', ink: '#2b2a28' },
  { id: 'band', name: '색 띠', hint: '흰 바탕에 색 띠', background: '#ffffff', ink: '#2b2a28', band: '#7a8b72' },
  { id: 'dark', name: '짙은 바탕', hint: '차콜 바탕, 밝은 글자', background: '#2b2a28', ink: '#f4efe6' },
  { id: 'essay', name: '에세이', hint: '따뜻한 브라운 바탕', background: '#8b6f54', ink: '#fffaf2' },
];

const text = (r: Rect, t: string, s: Partial<TextStyle>, extra: Partial<PageElement> = {}): PageElement => ({
  id: uid(), type: 'text', ...r, text: t, ...(extra as object),
  style: {
    fontFamily: 'Nanum Myeongjo', bold: false, fontSize: 10, lineHeight: 1.5, letterSpacing: 0, align: 'center', color: '#000000',
    paraSpacing: 0, indent: 0, wordBreak: 'word', ...s,
  },
});

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
  const els: PageElement[] = [];
  // 띠는 책 바깥쪽 재단선을 넘어 도련까지 채운다(재단 오차로 흰 틈이 생기지 않게)
  const over = 5;
  if (t.band) els.push({ id: uid(), type: 'rect', x: leftBound ? fx : fx - over, y: H * 0.16, w: W + over, h: H * 0.3, fill: t.band, opacity: 1 });
  const onBand = t.band ? '#ffffff' : t.ink;
  els.push(text({ x: fx + m, y: H * 0.22, w: W - m * 2, h: titleSize * 0.3528 * 1.35 * 2 }, title, { fontSize: titleSize, bold: true, lineHeight: 1.35, color: onBand }));
  if (subtitle) els.push(text({ x: fx + m, y: H * 0.22 + titleSize * 0.3528 * 1.35 * 2 + 3, w: W - m * 2, h: 8 }, subtitle, { fontSize: 10.5, color: onBand }));
  if (author) els.push(text({ x: fx + m, y: H * 0.58, w: W - m * 2, h: 8 }, author, { fontSize: 12, color: t.ink }));
  if (publisher) els.push(text({ x: fx + m, y: H - m - 6, w: W - m * 2, h: 6 }, publisher, { fontFamily: 'Pretendard', fontSize: 9, color: t.ink }));
  els.push(text({ x: bx + m, y: H * 0.3, w: W - m * 2, h: 40 }, '뒤표지에 넣을 책 소개 글을 써 보세요.', { fontSize: 9.5, lineHeight: 1.8, align: 'left', wordBreak: 'char', color: t.ink }));
  // 책등 제목: 위에서 아래로 읽히도록 90도 돌린다. x는 책등 가운데 기준.
  const spineLen = H * 0.6;
  els.push(text({ x: -spineLen / 2, y: H / 2 - 3, w: spineLen, h: 6 }, [title, author].filter(Boolean).join('   '),
    { fontSize: 9, lineHeight: 1.2, color: t.ink, bold: true }, { rotation: 90, spine: true }));
  return {
    background: t.background, elements: els, flap: keep?.flap ?? 0,
    paperId: keep?.paperId ?? 'mojo80', paperThickness: keep?.paperThickness ?? 0.1, spineOverride: keep?.spineOverride,
  };
}
