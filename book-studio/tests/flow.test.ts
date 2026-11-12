import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { derive, derivedContent, paginate, syncPages } from '../src/engine/flow';
import { registerFontData } from '../src/engine/fonts';
import { guessStyle, hwpParaText, importTxt } from '../src/engine/import';
import { exportPdf } from '../src/engine/pdf';
import { createProject, makeBlock, uid } from '../src/model/factory';
import { recommendedMargins } from '../src/model/presets';
import { templateCopy } from '../src/model/templates';
import type { Block } from '../src/model/types';

// describe 본문에서 바로 조판하므로 폰트를 먼저 등록한다
for (const [family, file, bold] of [
    ['Nanum Myeongjo', 'NanumMyeongjo-Regular', false], ['Nanum Myeongjo', 'NanumMyeongjo-Bold', true],
    ['Pretendard', 'Pretendard-Regular', false], ['Pretendard', 'Pretendard-Bold', true],
] as const) registerFontData(family, bold, new Uint8Array(readFileSync(`public/fonts/${file}.ttf`)), { builtin: true });

const para = '아침 공기가 차가웠다. 그는 “조금만 더 걸어 볼까?” 하고 혼잣말을 했다. 길은 생각보다 길었고(정말로 길었다), 발걸음은 생각보다 가벼웠다. ';
function sampleStory(chapters = 4, paras = 14): Block[] {
  const out: Block[] = [];
  for (let c = 1; c <= chapters; c++) {
    out.push(makeBlock('chapter', `제${c}장 산책`));
    for (let i = 0; i < paras; i++) {
      if (i === 5) out.push(makeBlock('section', `${c}.1 쉬어 가기`));
      if (i === 8) out.push(makeBlock('quote', '걷는다는 것은 생각한다는 것이다.'));
      out.push(makeBlock('body', para.repeat(1 + ((i * 7 + c) % 5))));
    }
  }
  return out;
}
const styles = templateCopy('essay').styles;
const W = 112;
const H = 181;
const textOf = (lines: { runs: { text: string }[] }[]) => lines.map((l) => l.runs.map((r) => r.text).join('')).join('');

describe('자동 조판', () => {
  const story = sampleStory();
  const p = paginate(story, styles, W, H, () => undefined);

  it('모든 글이 순서대로 빠짐없이 배치된다', () => {
    const got = p.pages.flat().map((f) => textOf(f.lines)).join('').replace(/\s/g, '');
    expect(got).toBe(story.map((b) => b.text).join('').replace(/\s/g, ''));
  });

  it('어떤 조각도 본문 영역을 벗어나지 않는다', () => {
    for (const page of p.pages) for (const f of page) expect(f.y + f.h).toBeLessThanOrEqual(H + 0.02);
  });

  it('장은 항상 새 쪽 맨 위에서, 지정한 간격만큼 내려와 시작한다', () => {
    const chapterPages = story.filter((b) => b.style === 'chapter').map((b) => p.blockPage.get(b.id)!);
    expect(new Set(chapterPages).size).toBe(4);
    for (const pi of chapterPages) {
      expect(p.pages[pi][0].block.style).toBe('chapter');
      expect(p.pages[pi][0].y).toBe(styles.chapter.spaceBefore);
    }
  });

  it('제목이 쪽 맨 아래에 홀로 남지 않는다', () => {
    for (const page of p.pages) expect(['chapter', 'section']).not.toContain(page[page.length - 1].block.style);
  });

  it('쪽을 넘어가는 문단은 양쪽에 두 줄 이상씩 남긴다(외톨이 줄 방지)', () => {
    const frags = new Map<string, number[]>();
    for (const f of p.pages.flat()) frags.set(f.block.id, [...(frags.get(f.block.id) ?? []), f.lines.length]);
    let split = 0;
    for (const counts of frags.values()) {
      if (counts.length < 2) continue;
      split++;
      for (const n of counts) expect(n).toBeGreaterThanOrEqual(2);
    }
    expect(split).toBeGreaterThan(3);
  });

  it('사용자가 고정한 쪽 나눔을 지킨다', () => {
    const s2 = story.map((b, i) => (i === 3 ? { ...b, breakBefore: true } : b));
    const p2 = paginate(s2, styles, W, H, () => undefined);
    expect(p2.pages[p2.blockPage.get(s2[3].id)!][0].block.id).toBe(s2[3].id);
    expect(p2.blockPage.get(s2[3].id)).toBe(p.blockPage.get(story[3].id)! + 1);
  });

  it('이미지는 본문 폭에 맞춰 통째로 놓인다', () => {
    const img = makeBlock('body', '', { assetId: 'a' });
    const p3 = paginate([story[1], img, story[2]], styles, W, H, () => ({ w: 1200, h: 800 }));
    const f = p3.pages.flat().find((x) => x.block.id === img.id)!;
    expect(f.w).toBe(W);
    expect(f.h).toBeCloseTo((W * 800) / 1200, 6);
  });
});

describe('책 구성', () => {
  const input = {
    title: '산책', subtitle: '', author: '김하루', publisher: '', presetId: 'shinkuk', width: 152, height: 225,
    duplex: true, binding: 'left' as const, margins: recommendedMargins(152, 225), templateId: 'essay',
    imported: { blocks: sampleStory(12, 14), assets: {} },
  };
  const project = syncPages(createProject(input), uid);
  const d = derive(project);

  it('원고 분량만큼 본문 쪽을, 항목 수만큼 차례 쪽을 만든다', () => {
    expect(project.pages.filter((p) => p.kind === 'flow').length).toBe(d.flowPagesNeeded);
    expect(d.flowPagesNeeded).toBeGreaterThan(20);
    expect(project.pages.filter((p) => p.kind === 'toc').length).toBe(d.tocPagesNeeded);
    expect(d.tocPagesNeeded).toBe(2);
    expect(syncPages(project, uid)).toBe(project); // 이미 맞으면 그대로
  });

  it('차례의 쪽 번호가 장이 실제로 놓인 쪽과 같다', () => {
    const chapters = d.toc.filter((e) => e.level === 0);
    expect(chapters.length).toBe(12);
    for (const e of chapters) {
      const pageIndex = Number(e.label) - 1;
      expect(project.pages[pageIndex].kind).toBe('flow');
      const first = derivedContent(project, pageIndex).texts.find((t) => t.blockId);
      expect(first!.blockId).toBe(e.blockId);
    }
  });

  it('쪽 번호와 머리말: 속표지엔 없고, 장 시작 쪽엔 머리말이 빠진다', () => {
    const has = (i: number, key: string) => derivedContent(project, i).texts.some((t) => t.key === key);
    expect(has(0, 'pn')).toBe(false);
    const chapterStart = Number(d.toc[0].label) - 1;
    expect(has(chapterStart, 'pn')).toBe(true);
    expect(has(chapterStart, 'hd')).toBe(false);
    expect(has(chapterStart + 1, 'hd')).toBe(true);
    const pn = derivedContent(project, chapterStart + 1).texts.find((t) => t.key === 'pn')!;
    expect(pn.lines[0].runs[0].text).toBe(String(chapterStart + 2));
  });

  it('원고가 줄면 남는 본문 쪽을 지우되, 요소를 올려 둔 쪽은 남긴다', () => {
    const flowIdx = project.pages.map((p, i) => (p.kind === 'flow' ? i : -1)).filter((i) => i >= 0);
    const keep = flowIdx[4];
    const withEl = { ...project, pages: project.pages.map((p, i) => (i === keep ? { ...p, elements: [{ id: 'x', type: 'image', assetId: 'q', x: 0, y: 0, w: 5, h: 5, fit: 'cover', opacity: 1 } as const] } : p)) };
    const shorter = syncPages({ ...withEl, story: withEl.story!.slice(0, 6) }, uid);
    const flows = shorter.pages.filter((p) => p.kind === 'flow');
    expect(flows.length).toBe(5);
    expect(flows[4].elements.length).toBe(1);
    expect(shorter.pages.filter((p) => p.kind === 'toc').length).toBe(1);
  });

  it('수백 쪽 분량도 빠르게 조판하고 PDF로 낸다', async () => {
    const big = syncPages(createProject({ ...input, imported: { blocks: sampleStory(40, 30), assets: {} } }), uid);
    const t0 = performance.now();
    const story = big.story!.map((b, i) => (i === 500 ? { ...b, text: b.text + ' 고침' } : b));
    const edited = syncPages({ ...big, story }, uid);
    const ms = performance.now() - t0;
    expect(edited.pages.length).toBeGreaterThan(300);
    expect(ms).toBeLessThan(250); // 한 문단을 고친 뒤 다시 조판하는 시간
    const bytes = await exportPdf(edited, { hbWasm: async () => readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm') });
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(edited.pages.length);
  }, 60000);
});

describe('원고 가져오기', () => {
  it('TXT에서 제목으로 보이는 줄을 찾는다', () => {
    expect(guessStyle('제3장 바다').style).toBe('chapter');
    expect(guessStyle('프롤로그').style).toBe('chapter');
    expect(guessStyle('제3장에서 그는 바다를 보았다고 했는데 그것은 사실이 아니었다.').style).toBe('body');
    expect(guessStyle('## 작은 제목')).toEqual({ style: 'section', text: '작은 제목' });
    const r = importTxt(new TextEncoder().encode('﻿제1장 시작\r\n\r\n첫 문단.\r\n둘째 문단.\r\n'));
    expect(r.blocks.map((b) => b.style)).toEqual(['chapter', 'body', 'body']);
  });

  it('EUC-KR로 저장한 TXT도 읽는다', () => {
    // '한글' (EUC-KR: C7 D1 B1 DB)
    const r = importTxt(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]));
    expect(r.blocks[0].text).toBe('한글');
    expect(r.warnings.join(' ')).toContain('EUC-KR');
  });

  it('HWP 문단 텍스트에서 제어 문자를 건너뛴다', () => {
    const units = [0xd55c, 0xae00, 11, 0, 0, 0, 0, 0, 0, 11, 0x0021, 13];
    const buf = new Uint8Array(new Uint16Array(units).buffer);
    expect(hwpParaText(buf)).toBe('한글!');
  });
});
