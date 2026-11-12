// 화면과 PDF가 함께 쓰는 배치 계산.
import type { Asset, ImageElement, Rect, TextElement } from '../model/types';
import { fontsVersion, resolveFont, type LoadedFont } from './fonts';
import { layoutText, type TextLayout } from './layout';

export interface ResolvedText {
  layout: TextLayout;
  font: LoadedFont;
  /** 문단 안 굵은 글자에 쓰는 폰트 */
  fontBold?: LoadedFont;
  /** 지정한 폰트가 없어 다른 폰트로 대체되었는지 */
  missingFont: boolean;
}

/** 같은 서체의 굵은 글꼴. 기본이 이미 굵거나 굵은 글꼴 파일이 없으면 없음. */
export function boldOf(family: string, base: LoadedFont): LoadedFont | undefined {
  if (base.bold) return undefined;
  const b = resolveFont(family, true);
  return !b.missing && b.font?.bold ? b.font : undefined;
}

const cache = new WeakMap<TextElement, { v: number; r: ResolvedText }>();

/** 요소 객체는 불변으로 다루므로 객체 단위로 조판 결과를 캐시한다. 바뀐 요소만 다시 조판된다. */
export function resolveText(el: TextElement): ResolvedText | null {
  const v = fontsVersion();
  const hit = cache.get(el);
  if (hit && hit.v === v) return hit.r;
  const { font, missing } = resolveFont(el.style.fontFamily, el.style.bold);
  if (!font) return null;
  const fontBold = boldOf(el.style.fontFamily, font);
  const r = { layout: layoutText(el.text, el.style, el.w, el.h, { regular: font, bold: fontBold }, { markup: true }), font, fontBold, missingFont: missing };
  cache.set(el, { v, r });
  return r;
}

/** 프레임 안에서 이미지가 실제로 그려지는 영역 (프레임 밖 부분은 잘린다) */
export function imageDrawRect(el: ImageElement, asset: Asset): Rect {
  if (el.fit === 'stretch' || !asset.pxW || !asset.pxH) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const ar = asset.pxW / asset.pxH;
  const frameAr = el.w / el.h;
  const widthBound = el.fit === 'cover' ? ar < frameAr : ar > frameAr;
  const w = widthBound ? el.w : el.h * ar;
  const h = widthBound ? el.w / ar : el.h;
  return { x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2, w, h };
}

/** 실제 인쇄 크기 기준 유효 해상도 */
export function effectiveDpi(el: ImageElement, asset: Asset): number {
  const r = imageDrawRect(el, asset);
  return Math.min(asset.pxW / (r.w / 25.4), asset.pxH / (r.h / 25.4));
}
