import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerFontData, resolveFont } from '../src/engine/fonts';
import { layoutText } from '../src/engine/layout';
import { exportPdf } from '../src/engine/pdf';
import { subsetFont } from '../src/engine/subset';
import { BODY_STYLE, contentRect, createProject, isRightHand, parseProjectFile } from '../src/model/factory';
import { recommendedMargins } from '../src/model/presets';

beforeAll(() => {
  for (const [family, file, bold] of [
    ['Nanum Myeongjo', 'NanumMyeongjo-Regular', false],
    ['Nanum Myeongjo', 'NanumMyeongjo-Bold', true],
    ['Pretendard', 'Pretendard-Regular', false],
    ['Pretendard', 'Pretendard-Bold', true],
  ] as const) {
    registerFontData(family, bold, new Uint8Array(readFileSync(`public/fonts/${file}.ttf`)), { builtin: true });
  }
});

const font = () => resolveFont('Nanum Myeongjo', false).font!;
const style = { ...BODY_STYLE, indent: 0, align: 'left' as const };
const textOf = (l: { runs: { text: string }[] }) => l.runs.map((r) => r.text).join('');

describe('조판', () => {
  it('상자 폭을 넘지 않게 줄을 나눈다', () => {
    const text = '가'.repeat(200);
    const r = layoutText(text, style, 100, 1000, font());
    expect(r.lines.length).toBeGreaterThan(1);
    for (const l of r.lines) expect(l.width).toBeLessThanOrEqual(100.001);
    expect(r.lines.map(textOf).join('')).toBe(text);
  });

  it('금칙: 닫는 문장부호는 줄 처음에, 여는 부호는 줄 끝에 오지 않는다', () => {
    const text = '그는 말했다. “안녕하세요.” 그리고 (조용히) 웃었다, 정말로! '.repeat(12);
    for (let w = 30; w < 90; w += 1.7) {
      const r = layoutText(text, style, w, 10000, font());
      for (const l of r.lines) {
        const t = textOf(l);
        expect('.,!?”)').not.toContain(t[0]);
        expect('“(').not.toContain(t[t.length - 1]);
      }
    }
  });

  it('어절 단위 줄바꿈은 낱말을 쪼개지 않는다', () => {
    const words = '책을 만드는 일은 생각보다 즐겁습니다 천천히 한 장씩 넘겨 보세요'.split(' ');
    const r = layoutText(words.join(' '), { ...style, wordBreak: 'word' }, 40, 1000, font());
    for (const l of r.lines) for (const w of textOf(l).trim().split(' ')) expect(words).toContain(w);
  });

  it('영문 낱말은 글자 단위 모드에서도 쪼개지 않는다', () => {
    const r = layoutText('publishing typography layout engine '.repeat(5), style, 45, 1000, font());
    for (const l of r.lines)
      for (const w of textOf(l).trim().split(' ')) expect(['publishing', 'typography', 'layout', 'engine']).toContain(w);
  });

  it('양쪽 정렬은 문단 마지막 줄을 뺀 모든 줄을 상자 폭에 맞춘다', () => {
    const text = '책을 만드는 일은 생각보다 즐겁습니다. 천천히 한 장씩 넘겨 보세요. '.repeat(6);
    const f = font();
    const r = layoutText(text, { ...style, align: 'justify' }, 80, 1000, f);
    const size = r.fontSizeMm;
    r.lines.slice(0, -1).forEach((l) => {
      const last = l.runs[l.runs.length - 1];
      const chars = Array.from(last.text);
      const end = last.x + chars.reduce((s, c) => s + f.adv(c.codePointAt(0)!) * size, 0) + last.ls * (chars.length - 1);
      expect(end).toBeCloseTo(80, 3);
    });
  });

  it('넘치는 글을 감지하고 들어가는 줄만 남긴다', () => {
    const r = layoutText('가나다라마바사\n'.repeat(30), style, 80, 30, font());
    expect(r.overflow).toBe(true);
    expect(r.fullHeight).toBeGreaterThan(30);
    const lineH = r.fontSizeMm * style.lineHeight;
    for (const l of r.lines) expect(l.top + lineH).toBeLessThanOrEqual(30.02);
  });

  it('첫 줄 들여쓰기와 문단 간격을 적용한다', () => {
    const r = layoutText('첫 문단\n둘째 문단', { ...style, indent: 4, paraSpacing: 3 }, 80, 100, font());
    expect(r.lines[0].runs[0].x).toBe(4);
    expect(r.lines[1].top - r.lines[0].top).toBeCloseTo(r.fontSizeMm * style.lineHeight + 3, 6);
  });
});

const hbWasm = async () => readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm');

describe('폰트 서브셋', () => {
  it('쓰인 글자의 글리프와 폭을 모두 보존한다', async () => {
    const text = '아침 공기가 차가웠다. 그는 “조금만 더 걸어 볼까?” 하고 혼잣말을 했다. Studio 2026';
    const cps = new Set(Array.from(text, (c) => c.codePointAt(0)!));
    const original = font();
    const sub = await subsetFont(original.data, cps, hbWasm);
    expect(sub.length).toBeLessThan(original.data.length / 20);
    const fk = (await import('@pdf-lib/fontkit')).default.create(sub as any) as any;
    for (const cp of cps) {
      expect(fk.hasGlyphForCodePoint(cp)).toBe(true);
      const g = fk.glyphForCodePoint(cp);
      expect(g.advanceWidth / fk.unitsPerEm).toBeCloseTo(original.adv(cp), 6);
      if (cp !== 32) expect(g.path.commands.length).toBeGreaterThan(0);
    }
  });
});

describe('문서 모델', () => {
  const input = {
    title: '나의 첫 책', subtitle: '부제', author: '지은이', publisher: '출판사', presetId: 'shinkuk',
    width: 152, height: 225, duplex: true, binding: 'left' as const, margins: recommendedMargins(152, 225),
  };

  it('좌철 양면 인쇄에서 홀수 쪽은 오른쪽, 안쪽 여백은 제본 쪽에 놓인다', () => {
    const p = createProject(input);
    expect(isRightHand(p, 0)).toBe(true);
    expect(isRightHand(p, 1)).toBe(false);
    expect(contentRect(p, 0).x).toBe(p.margins.inside);
    expect(contentRect(p, 1).x).toBe(p.margins.outside);
    const right = createProject({ ...input, binding: 'right' });
    expect(isRightHand(right, 0)).toBe(false);
  });

  it('프로젝트 파일을 저장하고 다시 읽을 수 있다', () => {
    const p = createProject(input);
    expect(parseProjectFile(JSON.stringify(p))).toEqual(p);
    expect(() => parseProjectFile('{"a":1}')).toThrow();
    expect(() => parseProjectFile('깨진 파일')).toThrow();
  });

  it('판형 크기 그대로 PDF를 만든다', async () => {
    const p = createProject(input);
    const bytes = await exportPdf(p, { hbWasm });
    expect(bytes.length).toBeLessThan(200_000);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo((152 * 72) / 25.4, 3);
    expect(height).toBeCloseTo((225 * 72) / 25.4, 3);
    expect(doc.getTitle()).toBe('나의 첫 책');
  });
});
