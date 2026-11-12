// Book Studio 문서 모델.
// 모든 길이는 mm, 글자 크기는 pt 단위다. 편집 화면과 PDF 출력이 이 모델 하나를 공유한다.

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface TextStyle {
  fontFamily: string;
  bold: boolean;
  /** pt */
  fontSize: number;
  /** 글자 크기 대비 배수 */
  lineHeight: number;
  /** 1/1000 em */
  letterSpacing: number;
  align: Align;
  /** #RRGGBB */
  color: string;
  /** 문단 뒤 간격, mm */
  paraSpacing: number;
  /** 문단 첫 줄 들여쓰기, mm */
  indent: number;
  /** char: 글자 단위 줄바꿈(책 본문 기본) / word: 어절 단위 줄바꿈 */
  wordBreak: 'char' | 'word';
}

interface BaseElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  style: TextStyle;
}

export type ImageFit = 'cover' | 'contain' | 'stretch';

export interface ImageElement extends BaseElement {
  type: 'image';
  assetId: string;
  fit: ImageFit;
  /** 0–1 */
  opacity: number;
}

export type PageElement = TextElement | ImageElement;

/**
 * free: 자유 배치 쪽 / flow: 원고가 자동으로 흘러 들어가는 본문 쪽 / toc: 자동 목차 쪽.
 * flow·toc 쪽의 내용은 원고에서 계산되며, elements에는 사용자가 덧붙인 요소만 담긴다.
 */
export type PageKind = 'free' | 'flow' | 'toc';

export interface Page {
  id: string;
  kind?: PageKind;
  /** 쪽 번호·머리말 같은 공통 요소를 이 쪽에서 숨긴다 */
  hideMaster?: boolean;
  elements: PageElement[];
}

export type StyleName = 'chapter' | 'section' | 'body' | 'quote';

/** 문단 스타일. 원고의 모든 문단은 이름으로 스타일을 참조하므로 스타일을 고치면 책 전체에 반영된다. */
export interface ParaStyle extends TextStyle {
  /** 문단 앞 간격 mm (쪽 맨 위에서는 새 쪽에서 시작하는 스타일에만 적용) */
  spaceBefore: number;
  /** 문단 뒤 간격 mm */
  spaceAfter: number;
  /** 좌우 들여 넣기 mm */
  inset: number;
  /** 항상 새 쪽에서 시작 */
  breakBefore: boolean;
}

export interface Block {
  id: string;
  style: StyleName;
  text: string;
  /** 본문 사이에 들어가는 이미지 */
  assetId?: string;
  /** 사용자가 고정한 쪽 나눔: 이 문단은 새 쪽에서 시작한다 */
  breakBefore?: boolean;
}

export type RunningText = 'none' | 'title' | 'chapter' | 'author';

/** 여러 쪽에 공통으로 들어가는 요소(마스터) */
export interface Master {
  pageNumber: {
    show: boolean;
    position: 'bottom-center' | 'bottom-outside';
    format: 'arabic' | 'roman';
    /** 쪽 번호를 매기기 시작하는 쪽(1부터) */
    firstPage: number;
    /** 시작 번호 */
    startAt: number;
  };
  header: { show: boolean; left: RunningText; right: RunningText };
  fontFamily: string;
  /** pt */
  fontSize: number;
  color: string;
}

export interface TocSettings {
  title: string;
  includeSections: boolean;
  leader: boolean;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  pxW: number;
  pxH: number;
}

export interface Margins {
  top: number;
  bottom: number;
  /** 제본되는 쪽 */
  inside: number;
  /** 책 바깥쪽 */
  outside: number;
}

export interface Project {
  version: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  meta: { title: string; subtitle: string; author: string; publisher: string };
  /** 재단 후 완성 크기 */
  format: { presetId: string; width: number; height: number };
  print: { duplex: boolean; binding: 'left' | 'right' };
  margins: Margins;
  pages: Page[];
  assets: Record<string, Asset>;
  /** 자동 조판되는 원고. 없으면 자유 배치 쪽만 있는 책이다. */
  story?: Block[];
  styles?: Record<StyleName, ParaStyle>;
  master?: Master;
  toc?: TocSettings;
  templateId?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
