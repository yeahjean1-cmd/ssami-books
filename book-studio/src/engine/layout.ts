// 텍스트 조판 엔진. 폰트 파일의 실제 글자 폭으로 줄을 나누고 각 글자 묶음의 위치를 계산한다.
// 편집 화면(SVG)과 PDF 출력은 모두 이 결과를 그대로 그리므로 줄바꿈과 위치가 일치한다.
import type { TextStyle } from '../model/types';
import { PT_TO_MM } from './units';

export interface FontMetrics {
  ascent: number;
  descent: number;
  adv(cp: number): number;
}

/** 기본 서체와, 문단 안 굵은 글자에 쓸 서체 */
export interface FontSet {
  regular: FontMetrics;
  bold?: FontMetrics;
}

export interface Run {
  text: string;
  /** 상자 왼쪽 기준 mm */
  x: number;
  /** 글자 사이 추가 간격 mm */
  ls: number;
  /** 굵게 */
  b?: boolean;
  /** 기울임 */
  i?: boolean;
  /** 위 첨자(각주 번호) */
  sup?: boolean;
  /** 각주 번호 자리: 문단 안에서 몇 번째 각주인지 */
  fn?: number;
}

export interface Line {
  runs: Run[];
  /** 상자 위쪽 기준 기준선 위치 mm */
  baseline: number;
  top: number;
  width: number;
  /** 이 줄에서 가리키는 각주(문단 안 순번) */
  notes?: number[];
}

export interface TextLayout {
  /** 상자 안에 들어간 줄 */
  lines: Line[];
  /** 상자에 들어가지 못한 줄이 있는지 */
  overflow: boolean;
  /** 전체 글을 담는 데 필요한 높이 mm */
  fullHeight: number;
  fontSizeMm: number;
  /** 본문에서 떼어 낸 각주 내용 */
  notes: string[];
}

export const SUP_SCALE = 0.6;
/** 위 첨자를 기준선에서 올리는 높이(글자 크기 대비) */
export const SUP_RISE = 0.36;

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

const BOLD = 1;
const ITALIC = 2;
const SUP = 4;

interface Parsed { chars: string[]; flags: number[]; fn: (number | undefined)[]; notes: string[] }

/**
 * 글 안의 간단한 표시를 해석한다: **굵게**, *기울임*, [^각주 내용].
 * 짝이 맞지 않는 별표는 글자 그대로 둔다.
 */
export function parseMarkup(text: string): Parsed {
  const src = Array.from(text);
  const out: Parsed = { chars: [], flags: [], fn: [], notes: [] };
  let bold = false;
  let italic = false;
  const closes = (from: number, double: boolean) => {
    for (let j = from; j < src.length && src[j] !== '\n'; j++) {
      if (src[j] !== '*') continue;
      const dbl = src[j + 1] === '*';
      if (double && dbl) return true;
      if (!double && !dbl) return true;
      if (dbl) j++;
    }
    return false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') {
      bold = italic = false;
    } else if (ch === '*' && src[i + 1] === '*') {
      if (bold || closes(i + 2, true)) {
        bold = !bold;
        i++;
        continue;
      }
    } else if (ch === '*') {
      if (italic || (src[i + 1] !== undefined && !isSpace(src[i + 1]) && closes(i + 1, false))) {
        italic = !italic;
        continue;
      }
    } else if (ch === '[' && src[i + 1] === '^') {
      const end = src.indexOf(']', i + 2);
      const nl = src.indexOf('\n', i + 2);
      if (end > i + 2 && (nl < 0 || nl > end)) {
        out.chars.push('0'); // 번호 자리. 실제 번호는 쪽을 나눌 때 정해진다.
        out.flags.push(SUP);
        out.fn.push(out.notes.length);
        out.notes.push(src.slice(i + 2, end).join('').trim());
        i = end;
        continue;
      }
    }
    out.chars.push(ch);
    out.flags.push((bold ? BOLD : 0) | (italic ? ITALIC : 0));
    out.fn.push(undefined);
  }
  return out;
}

/** 표시를 뺀 순수한 글 (목차·머리말용) */
export function plainText(text: string): string {
  const p = parseMarkup(text);
  return p.chars.filter((_, i) => !(p.flags[i] & SUP)).join('').replace(/\s+/g, ' ').trim();
}

export function layoutText(
  text: string,
  style: TextStyle,
  boxW: number,
  boxH: number,
  font: FontMetrics | FontSet,
  opts: { markup?: boolean } = {},
): TextLayout {
  const fonts: FontSet = 'regular' in font ? font : { regular: font };
  const base = fonts.regular;
  const size = style.fontSize * PT_TO_MM;
  const ls = (style.letterSpacing / 1000) * size;
  const lineH = size * style.lineHeight;
  const baseOffset = (lineH - (base.ascent + base.descent) * size) / 2 + base.ascent * size;
  const eps = 0.001;

  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  let parsed: Parsed;
  if (opts.markup && /\*|\[\^/.test(clean)) parsed = parseMarkup(clean);
  else {
    const chars = Array.from(clean);
    parsed = { chars, flags: [], fn: [], notes: [] };
  }
  const canBold = !!fonts.bold;

  const all: Line[] = [];
  let y = 0;
  // 문단 경계
  const bounds: [number, number][] = [];
  let from = 0;
  parsed.chars.forEach((c, i) => {
    if (c === '\n') {
      bounds.push([from, i]);
      from = i + 1;
    }
  });
  bounds.push([from, parsed.chars.length]);

  bounds.forEach(([p0, p1], pi) => {
    const chars = parsed.chars.slice(p0, p1);
    const flags = parsed.flags.length ? parsed.flags.slice(p0, p1) : null;
    const n = chars.length;
    const adv = chars.map((c, i) => {
      const f = flags ? flags[i] : 0;
      const m = f & BOLD && fonts.bold ? fonts.bold : base;
      const cp = f & SUP ? 0x31 : c.codePointAt(0)!;
      return m.adv(cp) * size * (f & SUP ? SUP_SCALE : 1);
    });
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
        // 각주 번호는 앞 글자에서 떨어지지 않는다
        if (i + 1 < n && !(flags && flags[i + 1] & SUP) && canBreak(chars[i], chars[i + 1], style.wordBreak)) lastBreak = i + 1;
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
      let x = indent;
      if (style.align === 'center') x += extra / 2;
      else if (style.align === 'right') x += extra;

      // 양쪽 정렬: 낱말 사이 공백에 남는 폭을 나눠 주고, 공백이 없으면 글자 사이에 나눠 준다
      let spaceAdd = 0;
      let lineLs = ls;
      if (style.align === 'justify' && !lastOfPara && count > 1 && extra > eps && extra < avail * 0.35) {
        let spaces = 0;
        for (let k = start; k < vEnd; k++) if (isSpace(chars[k])) spaces++;
        if (spaces > 0) spaceAdd = extra / spaces;
        else lineLs = ls + extra / (count - 1);
        width = avail;
      }

      const runs: Run[] = [];
      let notes: number[] | undefined;
      let run: Run | null = null;
      let runFlag = -1;
      for (let k = start; k < vEnd; k++) {
        const f = flags ? flags[k] : 0;
        const fnIdx = flags ? parsed.fn[p0 + k] : undefined;
        if (!run || f !== runFlag || fnIdx !== undefined) {
          run = { text: '', x, ls: lineLs };
          if (f & BOLD && canBold) run.b = true;
          if (f & ITALIC) run.i = true;
          if (f & SUP) run.sup = true;
          if (fnIdx !== undefined) {
            run.fn = fnIdx;
            (notes ??= []).push(fnIdx);
          }
          runs.push(run);
          runFlag = fnIdx !== undefined ? -1 : f;
        }
        run.text += chars[k];
        x += adv[k] + lineLs;
        if (spaceAdd && isSpace(chars[k])) {
          x += spaceAdd;
          run = null; // 벌어진 공백 뒤는 새 묶음으로 시작한다
        }
      }

      const line: Line = { runs, baseline: y + baseOffset, top: y, width };
      if (notes) line.notes = notes;
      all.push(line);
      y += lineH;
      start = end;
      first = false;
    } while (start < n);
    if (pi < bounds.length - 1) y += style.paraSpacing;
  });

  const lines = all.filter((l) => l.top + lineH <= boxH + 0.01);
  return { lines, overflow: lines.length < all.length, fullHeight: y, fontSizeMm: size, notes: parsed.notes };
}
