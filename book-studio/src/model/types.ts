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

export interface Page {
  id: string;
  elements: PageElement[];
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
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
