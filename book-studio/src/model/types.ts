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
  /** 가운데를 중심으로 한 회전(도, 시계 방향) */
  rotation?: number;
  /** 표지 전용: 책등에 놓인 요소. x는 책등 가운데 기준이다. */
  spine?: boolean;
  /** 잠금: 선택은 되지만 옮기거나 지울 수 없다 */
  locked?: boolean;
  /** 숨김: 화면과 PDF에 그리지 않는다 */
  hidden?: boolean;
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

export interface RectElement extends BaseElement {
  type: 'rect';
  /** 모양 (기본: 사각형) */
  shape?: 'ellipse';
  /** #RRGGBB */
  fill: string;
  opacity: number;
}

export type PageElement = TextElement | ImageElement | RectElement;

export type BindingType = 'perfect' | 'saddle';

/**
 * 표지. 뒤표지·책등·앞표지(와 날개)를 하나로 이어 편집한다.
 * 요소의 x는 책등을 뺀 좌표(0 = 뒤표지와 앞표지가 맞닿는 선)로 저장하므로,
 * 쪽수가 바뀌어 책등 너비가 달라져도 앞·뒤표지의 요소는 제자리를 지킨다.
 */
export interface Cover {
  background: string;
  elements: PageElement[];
  /** 날개 너비 mm (0 = 날개 없음) */
  flap: number;
  /** 내지 종이 한 장의 두께 mm */
  paperId: string;
  paperThickness: number;
  /** 인쇄소가 알려 준 책등 너비 mm. 있으면 계산값 대신 쓴다. */
  spineOverride?: number;
}

/** 인쇄소가 제공한 CMYK 출력 프로파일 */
export interface OutputProfile {
  name: string;
  /** base64 */
  data: string;
}

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
    /** 장이 시작할 때마다 번호를 다시 시작 */
    restartPerChapter?: boolean;
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
  print: {
    duplex: boolean;
    binding: 'left' | 'right';
    /** 도련 mm (기본 3) */
    bleed?: number;
    bindingType?: BindingType;
    profile?: OutputProfile;
  };
  margins: Margins;
  pages: Page[];
  assets: Record<string, Asset>;
  /** 자동 조판되는 원고. 없으면 자유 배치 쪽만 있는 책이다. */
  story?: Block[];
  styles?: Record<StyleName, ParaStyle>;
  master?: Master;
  toc?: TocSettings;
  templateId?: string;
  cover?: Cover;
  /** 모든 쪽에 공통으로 깔리는 요소(배경·장식). 공통 요소를 숨긴 쪽에는 나오지 않는다. */
  masterElements?: PageElement[];
  /** 본문 줄을 기준선 격자에 맞춘다: 좌우 쪽의 줄 높이가 나란해진다 */
  baselineGrid?: boolean;
  /** 각주 번호: 쪽마다 1부터(기본) 또는 책 전체에 이어서 */
  footnoteNumbering?: 'page' | 'book';
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
