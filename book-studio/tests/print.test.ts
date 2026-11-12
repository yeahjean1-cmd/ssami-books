import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { syncPages } from '../src/engine/flow';
import { registerFontData } from '../src/engine/fonts';
import { exportPdf, inspectIcc, toCmyk } from '../src/engine/pdf';
import { preflight } from '../src/engine/preflight';
import { COVER_TEMPLATES, computedSpine, convertSpine, coverAsProject, coverGeom, fromDisplay, makeCover, spineIsVertical, toDisplay } from '../src/model/cover';
import { createProject, makeBlock, makeText, uid } from '../src/model/factory';
import { recommendedMargins } from '../src/model/presets';
import type { PageElement, Project } from '../src/model/types';

for (const [family, file, bold] of [
  ['Nanum Myeongjo', 'NanumMyeongjo-Regular', false], ['Nanum Myeongjo', 'NanumMyeongjo-Bold', true],
  ['Pretendard', 'Pretendard-Regular', false], ['Pretendard', 'Pretendard-Bold', true],
] as const) registerFontData(family, bold, new Uint8Array(readFileSync(`public/fonts/${file}.ttf`)), { builtin: true });

const mm = (v: number) => (v * 72) / 25.4;
const hbWasm = async () => readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm');
const para = '아침 공기가 차가웠다. 그는 조금만 더 걸어 볼까 하고 혼잣말을 했다. 길은 생각보다 길었다. ';
function book(chapters = 6): Project {
  const blocks = Array.from({ length: chapters }, (_, c) => [makeBlock('chapter', `제${c + 1}장`), ...Array.from({ length: 12 }, () => makeBlock('body', para.repeat(4)))]).flat();
  const p = createProject({
    title: '산책', subtitle: '', author: '김하루', publisher: '하루출판', presetId: 'shinkuk', width: 152, height: 225, duplex: true, binding: 'left',
    margins: recommendedMargins(152, 225), templateId: 'essay', imported: { blocks, assets: {} },
  });
  return syncPages(p, uid);
}
const withCover = (p: Project, patch = {}) => ({ ...p, cover: { ...makeCover(p, 'band'), ...patch } });
// 시험용 출력 프로파일: CC0 CMYK 프로파일의 종류 표기만 출력 장치용으로 바꾼다
const icc = new Uint8Array(readFileSync('tests/fixtures/CGATS001Compat-v2-micro.icc'));
const prtr = icc.slice();
prtr.set(new TextEncoder().encode('prtr'), 12);

describe('표지', () => {
  const p = withCover(book());

  it('책등 = 내지 장수 × 종이 두께, 중철은 0', () => {
    expect(computedSpine(p)).toBeCloseTo(Math.round((Math.ceil(p.pages.length / 2) * 0.1) * 10) / 10, 6);
    expect(computedSpine({ ...p, print: { ...p.print, bindingType: 'saddle' } })).toBe(0);
    const g = coverGeom(withCover(p, { flap: 80, spineOverride: 12 }));
    expect(g.spine).toBe(12);
    expect(g.width).toBe(80 + 152 + 12 + 152 + 80);
    expect(g.frontX).toBe(80 + 152 + 12);
  });

  it('쪽수가 늘어 책등이 넓어져도 앞·뒤표지 요소는 제자리, 책등 요소는 책등 가운데', () => {
    const g1 = coverGeom(p);
    const thick = { ...p, pages: [...p.pages, ...p.pages, ...p.pages] };
    const g2 = coverGeom(thick);
    expect(g2.spine).toBeGreaterThan(g1.spine * 2.5);
    for (const el of p.cover.elements) {
      const a = toDisplay(el, g1);
      const b = toDisplay(el, g2);
      if (el.spine) expect(b.x + b.w / 2).toBeCloseTo(g2.spineX + g2.spine / 2, 6);
      else if (el.x >= 0) expect(b.x - g2.frontX).toBeCloseTo(a.x - g1.frontX, 6);
      else expect(b.x).toBeCloseTo(a.x, 6);
    }
  });

  it('화면 좌표 ↔ 저장 좌표를 오가도 값이 유지되고, 책등 위로 옮기면 책등 요소가 된다', () => {
    const g = coverGeom(withCover(p, { spineOverride: 14 }));
    for (const el of p.cover.elements) {
      const back = fromDisplay(toDisplay(el, g), g);
      expect(back.x).toBeCloseTo(el.x, 9); // 소수 좌표는 부동소수점 오차만큼만 달라질 수 있다
      expect({ ...back, x: 0 }).toEqual({ ...el, x: 0, spine: el.spine ? true : undefined });
    }
    // 책등 글자는 세로쓰기 ↔ 눕혀 쓰기로 바꿀 수 있고, 글은 그대로 남는다
    expect(spineIsVertical(p.cover)).toBe(true);
    const lying = convertSpine(p.cover, 225, false);
    expect(spineIsVertical(lying)).toBe(false);
    const again = convertSpine(lying, 225, true);
    const spineText = (c: typeof p.cover) => (c.elements.find((e) => e.spine) as any).text.replace(/\s/g, '');
    expect(spineText(again)).toBe(spineText(p.cover));
    expect(spineText(lying)).toBe(spineText(p.cover));
    const moved = fromDisplay({ ...toDisplay(p.cover.elements[0], g), x: g.spineX + 2, w: 6 } as PageElement, g);
    expect(moved.spine).toBe(true);
    // 앞뒤 표지에 걸친 요소는 책등만큼 늘어난다
    const span: PageElement = { id: 's', type: 'rect', x: -152, y: 0, w: 304, h: 20, fill: '#000000', opacity: 1 };
    expect(toDisplay(span, g).w).toBe(304 + 14);
    expect(fromDisplay(toDisplay(span, g), g)).toEqual({ ...span, spine: undefined });
  });
});

describe('인쇄용 PDF', () => {
  const p = withCover(book(3), { spineOverride: 10 });
  const streamText = (doc: PDFDocument, i: number) => {
    const c = doc.getPage(i).node.Contents()!;
    const list = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
    return list.map((s) => new TextDecoder('latin1').decode(decodePDFRawStream(s as PDFRawStream).decode())).join('\n');
  };

  it('검정은 먹 1도, 색은 CMYK로 바꾼다', () => {
    expect(toCmyk('#000000')).toEqual([0, 0, 0, 1]);
    expect(toCmyk('#1f1e1c')[3]).toBeGreaterThan(0.85);
    expect(toCmyk('#1f1e1c').slice(0, 3)).toEqual([0, 0, 0]);
    const [c, m, y, k] = toCmyk('#ff0000');
    expect([c, m, y, k]).toEqual([0, 1, 1, 0]);
  });

  it('표지: 도련·재단선을 넣으면 재단 크기와 도련 크기가 정확히 기록된다', async () => {
    const doc = await PDFDocument.load(await exportPdf(p, { target: 'cover', bleed: true, marks: true, cmyk: true, hbWasm }));
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    const trim = page.getTrimBox();
    const bleed = page.getBleedBox();
    expect(trim.width).toBeCloseTo(mm(152 * 2 + 10), 3);
    expect(trim.height).toBeCloseTo(mm(225), 3);
    expect(bleed.width).toBeCloseTo(mm(152 * 2 + 10 + 6), 3);
    expect(trim.x - bleed.x).toBeCloseTo(mm(3), 3);
    expect(page.getMediaBox().width).toBeGreaterThan(bleed.width + mm(10)); // 재단선 자리
    const ops = streamText(doc, 0);
    expect(ops).toMatch(/ k\n/);
    expect(ops).not.toMatch(/ rg\n/);
    expect(ops).not.toMatch(/ RG\n/);
  });

  it('내지: 화면용은 완성 크기 그대로, 인쇄용은 쪽마다 도련을 둔다', async () => {
    const screen = await PDFDocument.load(await exportPdf(p, { hbWasm }));
    expect(screen.getPage(1).getMediaBox().width).toBeCloseTo(mm(152), 3);
    const print = await PDFDocument.load(await exportPdf(p, { bleed: true, cmyk: true, hbWasm }));
    expect(print.getPageCount()).toBe(p.pages.length);
    expect(print.getPage(1).getMediaBox().width).toBeCloseTo(mm(158), 3);
    expect(print.getPage(1).getTrimBox().width).toBeCloseTo(mm(152), 3);
  });

  it('출력 프로파일은 CMYK 출력 장치용만 받는다', () => {
    expect(() => inspectIcc(icc)).toThrow(/출력 장치용/);
    expect(() => inspectIcc(new Uint8Array(readFileSync('public/icc/sRGB-v2-micro.icc')))).toThrow(/CMYK/);
    expect(() => inspectIcc(new Uint8Array(200))).toThrow();
    expect(inspectIcc(prtr).name.length).toBeGreaterThan(2);
  });

  it('PDF/X-4: 출력 인텐트·버전 표기·XMP·문서 ID·RGB 색 공간 지정을 넣는다', async () => {
    await expect(exportPdf(p, { pdfx: true, hbWasm })).rejects.toThrow(/출력 프로파일/);
    const withProfile = { ...p, print: { ...p.print, profile: { name: 'Test CMYK', data: Buffer.from(prtr).toString('base64') } } };
    const bytes = await exportPdf(withProfile, {
      target: 'cover', bleed: true, marks: true, cmyk: true, pdfx: true, hbWasm, srgbProfile: new Uint8Array(readFileSync('public/icc/sRGB-v2-micro.icc')),
    });
    const doc = await PDFDocument.load(bytes);
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFX'));
    expect(intent.get(PDFName.of('DestOutputProfile'))).toBeDefined();
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeDefined();
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).toContain('/GTS_PDFXVersion (PDF/X-4)');
    expect(raw).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
    expect(raw).toMatch(/\/ID\s*\[\s*<[0-9a-fA-F]{32}>/);
    expect(raw).toContain('/DefaultRGB');
    expect(raw).toContain('/Trapped /False');
    expect(raw.startsWith('%PDF-1.6')).toBe(true);
  });
});

describe('인쇄 사전 검사', () => {
  const clean = withCover(book(3));
  const levels = (p: Project, level: string) => preflight(p).filter((i) => i.level === level);

  it('문제없는 책에는 오류가 없고, 표지 템플릿은 그대로 써도 경고가 없다', () => {
    expect(levels(clean, 'error')).toEqual([]);
    for (const { id } of COVER_TEMPLATES) {
      const thick = { ...clean, cover: { ...makeCover(clean, id), spineOverride: 14 } };
      expect(levels(thick, 'warn').filter((i) => i.cover)).toEqual([]);
    }
  });

  it('글 넘침, 저해상도 이미지, 없는 이미지, 도련 누락, 안전 영역 침범을 위치와 함께 찾는다', () => {
    const els: PageElement[] = [
      makeText({ x: 20, y: 20, w: 60, h: 10 }, para.repeat(10)),
      { id: 'low', type: 'image', assetId: 'a', x: 20, y: 60, w: 100, h: 100, fit: 'stretch', opacity: 1 },
      { id: 'gone', type: 'image', assetId: 'none', x: 20, y: 60, w: 10, h: 10, fit: 'cover', opacity: 1 },
      { id: 'edge', type: 'rect', x: 0, y: 200, w: 152, h: 25, fill: '#7a8b72', opacity: 1 },
      { id: 'bled', type: 'rect', x: -3, y: -3, w: 158, h: 20, fill: '#7a8b72', opacity: 1 },
      makeText({ x: 1, y: 100, w: 40, h: 8 }, '가장자리 글'),
    ];
    const p: Project = {
      ...clean, assets: { a: { id: 'a', name: 'a.png', mime: 'image/png', dataUrl: '', pxW: 300, pxH: 300 } },
      pages: clean.pages.map((pg, i) => (i === 0 ? { ...pg, elements: els } : pg)),
    };
    const issues = preflight(p).filter((i) => i.page === 0);
    const of = (id: string) => issues.filter((i) => i.elementId === id).map((i) => `${i.level}:${i.text}`).join(' ');
    expect(of(els[0].id)).toMatch(/error:글이 상자보다/);
    expect(of('low')).toMatch(/error:이미지 해상도가 너무 낮아요\(76dpi\)/);
    expect(of('gone')).toMatch(/error:이미지 원본이 없어요/);
    expect(of('edge')).toMatch(/warn:재단선까지 닿는 요소/);
    expect(of('bled')).toBe('');
    expect(of(els[5].id)).toMatch(/warn:글 상자가 재단선에서/);
  });

  it('제본과 표지 조건을 확인한다', () => {
    const saddle = { ...clean, print: { ...clean.print, bindingType: 'saddle' as const }, pages: clean.pages.slice(0, 6) };
    expect(levels(saddle, 'error').map((i) => i.text).join()).toMatch(/4의 배수/);
    const thin = { ...clean, cover: { ...clean.cover, spineOverride: 3 } };
    expect(levels(thin, 'warn').some((i) => i.cover && /책등이 3mm로 좁아요/.test(i.text))).toBe(true);
    expect(levels(thin, 'info').some((i) => /계산값/.test(i.text))).toBe(true);
    expect(preflight({ ...clean, cover: undefined }).some((i) => /표지가 아직 없어요/.test(i.text))).toBe(true);
    // 표지도 한 쪽짜리 문서로 다뤄진다
    expect(coverAsProject(clean).pages[0].elements.length).toBe(clean.cover.elements.length);
  });
});
