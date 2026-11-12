// 텍스트 조판 엔진. 폰트 파일의 실제 글자 폭으로 줄을 나누고 각 글자 묶음의 위치를 계산한다.
// 편집 화면(SVG)과 PDF 출력은 모두 이 결과를 그대로 그리므로 줄바꿈과 위치가 일치한다.
import type { TextStyle } from '../model/types';
import { PT_TO_MM } from './units';

export interface FontMetrics {
  ascent: number;
  descent: number;
  adv(cp: number): number;
}

export interface Run {
  text: string;
  /** 상자 왼쪽 기준 mm */
  x: number;
  /** 글자 사이 추가 간격 mm */
  ls: number;
}

export interface Line {
  runs: Run[];
  /** 상자 위쪽 기준 기준선 위치 mm */
  baseline: number;
  top: number;
  width: number;
}

export interface TextLayout {
  /** 상자 안에 들어간 줄 */
  lines: Line[];
  /** 상자에 들어가지 못한 줄이 있는지 */
  overflow: boolean;
  /** 전체 글을 담는 데 필요한 높이 mm */
  fullHeight: number;
  fontSizeMm: number;
}

// 금칙 처리: 줄 처음에 올 수 없는 글자 / 줄 끝에 올 수 없는 글자
const NO_START = new Set(Array.from(')]}〉》」』】〕’”,.!?:;、。·…‥%℃°'));
const NO_END = new Set(Array.from('([{〈《「『【〔‘“'));

const isSpace = (ch: string) => ch === ' ' || ch === ' ' || ch === '　';

function isCJK(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0x3040 && cp <= 0x30ff) || // 가나
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) || // 한자
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

function canBreak(a: string, b: string, mode: 'char' | 'word'): boolean {
  if (isSpace(b)) return false; // 공백은 앞 줄 끝에 매달린다
  if (NO_START.has(b) || NO_END.has(a)) return false;
  if (isSpace(a)) return a !== ' ';
  if (mode === 'word') return false;
  return isCJK(a.codePointAt(0)!) || isCJK(b.codePointAt(0)!);
}

export function layoutText(
  text: string,
  style: TextStyle,
  boxW: number,
  boxH: number,
  font: FontMetrics,
): TextLayout {
  const size = style.fontSize * PT_TO_MM;
  const ls = (style.letterSpacing / 1000) * size;
  const lineH = size * style.lineHeight;
  const baseOffset = (lineH - (font.ascent + font.descent) * size) / 2 + font.ascent * size;
  const eps = 0.001;

  const all: Line[] = [];
  let y = 0;
  const paragraphs = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');

  paragraphs.forEach((para, pi) => {
    const chars = Array.from(para);
    const n = chars.length;
    const adv = chars.map((c) => font.adv(c.codePointAt(0)!) * size);
    let start = 0;
    let first = true;
    do {
      const indent = first ? Math.min(style.indent, boxW / 2) : 0;
      const avail = Math.max(boxW - indent, size);
      let w = 0;
      let i = start;
      let lastBreak = -1;
      for (; i < n; i++) {
        if (!isSpace(chars[i]) && i > start && w + adv[i] > avail + eps) break;
        w += adv[i] + ls;
        if (i + 1 < n && canBreak(chars[i], chars[i + 1], style.wordBreak)) lastBreak = i + 1;
      }
      const end = i >= n ? n : lastBreak > start ? lastBreak : i;
      const lastOfPara = end >= n;

      let vEnd = end;
      while (vEnd > start && isSpace(chars[vEnd - 1])) vEnd--;
      const count = vEnd - start;
      let width = 0;
      for (let k = start; k < vEnd; k++) width += adv[k];
      width += ls * Math.max(0, count - 1);

      const extra = avail - width;
      let x0 = indent;
      if (style.align === 'center') x0 += extra / 2;
      else if (style.align === 'right') x0 += extra;

      const runs: Run[] = [];
      const doJustify = style.align === 'justify' && !lastOfPara && count > 1 && extra > eps && extra < avail * 0.35;
      if (doJustify) {
        let spaces = 0;
        for (let k = start; k < vEnd; k++) if (isSpace(chars[k])) spaces++;
        if (spaces > 0) {
          // 낱말 사이 공백에 남는 폭을 나눠 준다
          const add = extra / spaces;
          let x = x0;
          let runStart = start;
          let runX = x;
          for (let k = start; k < vEnd; k++) {
            x += adv[k] + ls;
            if (isSpace(chars[k])) {
              x += add;
              runs.push({ text: chars.slice(runStart, k + 1).join(''), x: runX, ls });
              runStart = k + 1;
              runX = x;
            }
          }
          if (runStart < vEnd) runs.push({ text: chars.slice(runStart, vEnd).join(''), x: runX, ls });
        } else {
          runs.push({ text: chars.slice(start, vEnd).join(''), x: x0, ls: ls + extra / (count - 1) });
        }
        width = avail;
      } else if (count > 0) {
        runs.push({ text: chars.slice(start, vEnd).join(''), x: x0, ls });
      }

      all.push({ runs, baseline: y + baseOffset, top: y, width });
      y += lineH;
      start = end;
      first = false;
    } while (start < n);
    if (pi < paragraphs.length - 1) y += style.paraSpacing;
  });

  const lines = all.filter((l) => l.top + lineH <= boxH + 0.01);
  return { lines, overflow: lines.length < all.length, fullHeight: y, fontSizeMm: size };
}
