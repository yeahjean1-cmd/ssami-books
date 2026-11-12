import type { Master, ParaStyle, StyleName, TocSettings } from './types';

export interface InteriorTemplate {
  id: string;
  name: string;
  hint: string;
  styles: Record<StyleName, ParaStyle>;
  master: Master;
}

export const STYLE_LABEL: Record<StyleName, string> = { chapter: '장 제목', section: '절 제목', body: '본문', quote: '인용문' };
export const STYLE_NAMES: StyleName[] = ['chapter', 'section', 'body', 'quote'];

const base: ParaStyle = {
  fontFamily: 'Nanum Myeongjo', bold: false, fontSize: 10, lineHeight: 1.75, letterSpacing: 0, align: 'justify',
  color: '#1f1e1c', paraSpacing: 0, indent: 3.5, wordBreak: 'char', spaceBefore: 0, spaceAfter: 0, inset: 0, breakBefore: false,
};
const st = (o: Partial<ParaStyle>): ParaStyle => ({ ...base, ...o });
const heading = (o: Partial<ParaStyle>) => st({ align: 'left', indent: 0, wordBreak: 'word', bold: true, lineHeight: 1.4, ...o });
const master = (o: Partial<Master> = {}): Master => ({
  pageNumber: { show: true, position: 'bottom-center', format: 'arabic', firstPage: 1, startAt: 1 },
  header: { show: true, left: 'title', right: 'chapter' },
  fontFamily: 'Pretendard', fontSize: 8, color: '#6f6a62', ...o,
});

export const TEMPLATES: InteriorTemplate[] = [
  {
    id: 'essay', name: '에세이형', hint: '넉넉한 행간, 차분한 명조',
    styles: {
      chapter: heading({ fontSize: 17, spaceBefore: 34, spaceAfter: 16, breakBefore: true }),
      section: heading({ fontSize: 11.5, spaceBefore: 8, spaceAfter: 3 }),
      body: st({ lineHeight: 1.85 }),
      quote: st({ fontSize: 9.5, inset: 7, indent: 0, spaceBefore: 4, spaceAfter: 4, color: '#4a4640' }),
    },
    master: master(),
  },
  {
    id: 'novel', name: '소설형', hint: '고운바탕, 촘촘한 본문, 가운데 장 제목',
    styles: {
      chapter: heading({ fontFamily: 'Gowun Batang', fontSize: 15, align: 'center', spaceBefore: 45, spaceAfter: 22, breakBefore: true }),
      section: heading({ fontFamily: 'Gowun Batang', fontSize: 10.5, align: 'center', spaceBefore: 7, spaceAfter: 4 }),
      body: st({ fontFamily: 'Gowun Batang', fontSize: 9.8, lineHeight: 1.7 }),
      quote: st({ fontFamily: 'Gowun Batang', fontSize: 9.3, inset: 6, indent: 0, spaceBefore: 3, spaceAfter: 3 }),
    },
    master: master({ pageNumber: { show: true, position: 'bottom-outside', format: 'arabic', firstPage: 1, startAt: 1 } }),
  },
  {
    id: 'poetry', name: '시집형', hint: '왼쪽 정렬, 넓은 여백과 행간',
    styles: {
      chapter: heading({ fontSize: 13, spaceBefore: 26, spaceAfter: 14, breakBefore: true }),
      section: heading({ fontSize: 10.5, spaceBefore: 8, spaceAfter: 4 }),
      body: st({ fontSize: 10, lineHeight: 2.1, align: 'left', indent: 0, wordBreak: 'word' }),
      quote: st({ fontSize: 9, inset: 8, indent: 0, align: 'left', spaceBefore: 4, spaceAfter: 4, color: '#4a4640' }),
    },
    master: master({ header: { show: false, left: 'none', right: 'none' } }),
  },
  {
    id: 'practical', name: '실용서형', hint: '나눔고딕 본문, 문단 사이 간격',
    styles: {
      chapter: heading({ fontFamily: 'Pretendard', fontSize: 19, spaceBefore: 22, spaceAfter: 14, breakBefore: true }),
      section: heading({ fontFamily: 'Pretendard', fontSize: 12, spaceBefore: 9, spaceAfter: 3 }),
      body: st({ fontFamily: 'Nanum Gothic', fontSize: 9.5, lineHeight: 1.7, indent: 0, spaceAfter: 2.5 }),
      quote: st({ fontFamily: 'Nanum Gothic', fontSize: 9, inset: 6, indent: 0, spaceBefore: 3, spaceAfter: 4, color: '#4a4640' }),
    },
    master: master({ pageNumber: { show: true, position: 'bottom-outside', format: 'arabic', firstPage: 1, startAt: 1 } }),
  },
];

export const DEFAULT_TOC: TocSettings = { title: '차례', includeSections: true, leader: true };

export const templateById = (id?: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

/** 템플릿은 고정 디자인이 아니라 시작점이다. 복사본을 프로젝트에 넣어 자유롭게 고칠 수 있게 한다. */
export function templateCopy(id?: string) {
  const t = templateById(id);
  return { templateId: t.id, styles: structuredClone(t.styles), master: structuredClone(t.master) };
}
