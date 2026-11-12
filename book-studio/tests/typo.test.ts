import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { derive, derivedContent, paginate, syncPages } from '../src/engine/flow';
import { registerFontData, resolveFont } from '../src/engine/fonts';
import { layoutText, parseMarkup, plainText } from '../src/engine/layout';
import { exportPdf } from '../src/engine/pdf';
import { BODY_STYLE, createProject, makeBlock, uid } from '../src/model/factory';
import { recommendedMargins } from '../src/model/presets';
import { templateCopy } from '../src/model/templates';

for (const [family, file, bold] of [
  ['Nanum Myeongjo', 'NanumMyeongjo-Regular', false], ['Nanum Myeongjo', 'NanumMyeongjo-Bold', true],
  ['Pretendard', 'Pretendard-Regular', false], ['Pretendard', 'Pretendard-Bold', true],
] as const) registerFontData(family, bold, new Uint8Array(readFileSync(`public/fonts/${file}.ttf`)), { builtin: true });

const fonts = { regular: resolveFont('Nanum Myeongjo', false).font!, bold: resolveFont('Nanum Myeongjo', true).font! };
const style = { ...BODY_STYLE, indent: 0, align: 'left' as const };
const styles = templateCopy('essay').styles;
const para = '아침 공기가 차가웠다. 그는 조금만 더 걸어 볼까 하고 혼잣말을 했다. 길은 생각보다 길었다. ';

describe('문단 안 글자 서식', () => {
  it('**굵게**, *기울임*, [^각주]를 해석하고 표시는 글에서 뺀다', () => {
    const r = layoutText('그는 **천천히** 걸었다. *Walden*을 읽었다[^소로, 1854년.].', style, 200, 100, fonts, { markup: true });
    const runs = r.lines[0].runs;
    expect(runs.map((x) => x.text).join('')).toBe('그는 천천히 걸었다. Walden을 읽었다0.');
    expect(runs.find((x) => x.b)!.text).toBe('천천히');
    expect(runs.find((x) => x.i)!.text).toBe('Walden');
    expect(runs.find((x) => x.sup)).toMatchObject({ text: '0', fn: 0 });
    expect(r.notes).toEqual(['소로, 1854년.']);
    expect(r.lines[0].notes).toEqual([0]);
  });

  it('굵은 글자는 굵은 글꼴의 폭으로 잰다', () => {
    const plain = layoutText('가나다라마바사', style, 200, 100, fonts, { markup: true }).lines[0];
    const bold = layoutText('**가나다라마바사**', style, 200, 100, fonts, { markup: true }).lines[0];
    const boldOnly = layoutText('가나다라마바사', style, 200, 100, { regular: fonts.bold }).lines[0];
    expect(bold.width).toBeCloseTo(boldOnly.width, 6);
    expect(bold.runs[0].b).toBe(true);
    expect(plain.runs[0].b).toBeUndefined();
  });

  it('짝이 없는 별표와 표시를 켜지 않은 글은 그대로 둔다', () => {
    expect(parseMarkup('3 * 4 = 12').chars.join('')).toBe('3 * 4 = 12');
    expect(parseMarkup('별 하나* 그리고 끝').chars.join('')).toBe('별 하나* 그리고 끝');
    expect(layoutText('**그대로**', style, 200, 100, fonts).lines[0].runs[0].text).toBe('**그대로**');
    expect(plainText('**제1장** 산책[^주석]')).toBe('제1장 산책');
  });
});

describe('각주', () => {
  const W = 112;
  const H = 181;
  const story = [
    makeBlock('chapter', '제1장'),
    ...Array.from({ length: 30 }, (_, i) => makeBlock('body', para.repeat(3) + (i % 4 === 1 ? `끝[^${i}번 문단의 각주입니다. ${'조금 긴 설명을 덧붙입니다. '.repeat(i % 3)}]` : ''))),
  ];
  const p = paginate(story, styles, W, H, () => undefined);

  it('각주는 번호가 달린 줄과 같은 쪽에 놓이고, 쪽마다 1번부터 매긴다', () => {
    let total = 0;
    p.pages.forEach((page, pi) => {
      const marks = page.flatMap((f) => f.lines.flatMap((l) => l.runs.filter((r) => r.fn !== undefined).map((r) => r.text)));
      expect(marks).toEqual(p.notes[pi].map((n) => String(n.n)));
      expect(marks).toEqual(marks.map((_, i) => String(i + 1)));
      total += marks.length;
    });
    expect(total).toBe(story.filter((b) => b.text.includes('[^')).length);
    expect(p.notes.filter((n) => n.length).length).toBeGreaterThan(2);
  });

  it('본문과 각주가 겹치지 않는다', () => {
    const project = syncPages(createProject({
      title: '각주', subtitle: '', author: '', publisher: '', presetId: 'shinkuk', width: 152, height: 225, duplex: true, binding: 'left',
      margins: recommendedMargins(152, 225), templateId: 'essay', imported: { blocks: story, assets: {} },
    }), uid);
    const d = derive(project);
    let checked = 0;
    project.pages.forEach((_, i) => {
      const dc = derivedContent(project, i);
      const notes = dc.texts.filter((t) => t.key.startsWith('note-'));
      if (!notes.length) return;
      const bodyBottom = Math.max(...dc.texts.filter((t) => t.blockId).map((t) => t.y + t.h));
      expect(bodyBottom).toBeLessThanOrEqual(dc.rules[0].y + 0.01);
      expect(notes[notes.length - 1].y + notes[notes.length - 1].h).toBeCloseTo(225 - project.margins.bottom, 3);
      checked++;
    });
    expect(checked).toBeGreaterThan(2);
    expect(d.flowPagesNeeded).toBe(p.pages.length);
  });
});

describe('기준선 격자와 장별 쪽 번호', () => {
  const story = Array.from({ length: 3 }, (_, c) => [
    makeBlock('chapter', `제${c + 1}장`),
    ...Array.from({ length: 10 }, (_, i) => makeBlock(i === 4 ? 'section' : i === 6 ? 'quote' : 'body', i === 4 ? '쉬어 가기' : para.repeat(3))),
  ]).flat();

  it('격자를 켜면 모든 본문 문단이 본문 줄 높이의 배수 자리에서 시작한다', () => {
    const lineH = styles.body.fontSize * (25.4 / 72) * styles.body.lineHeight;
    const onGrid = (v: number) => Math.abs(v / lineH - Math.round(v / lineH)) < 1e-6;
    const off = paginate(story, styles, 112, 181, () => undefined).pages.flat().filter((f) => f.block.style === 'body');
    const on = paginate(story, styles, 112, 181, () => undefined, { grid: true }).pages.flat().filter((f) => f.block.style === 'body');
    expect(off.some((f) => !onGrid(f.y))).toBe(true);
    expect(on.every((f) => onGrid(f.y))).toBe(true);
  });

  it('장별 쪽 번호: 장이 시작하는 쪽마다 번호를 다시 시작한다', async () => {
    const base = syncPages(createProject({
      title: '번호', subtitle: '', author: '', publisher: '', presetId: 'shinkuk', width: 152, height: 225, duplex: true, binding: 'left',
      margins: recommendedMargins(152, 225), templateId: 'essay', imported: { blocks: story, assets: {} },
    }), uid);
    const p = { ...base, master: { ...base.master!, pageNumber: { ...base.master!.pageNumber, restartPerChapter: true } } };
    const d = derive(p);
    const starts = d.toc.filter((e) => e.level === 0);
    expect(starts.map((e) => e.label)).toEqual(['1', '1', '1']);
    expect(d.labels.filter((l) => l === '2').length).toBe(4); // 차례 쪽(2쪽) + 세 장의 둘째 쪽
    // 서식과 각주가 섞인 책도 PDF로 나온다
    const marked = { ...p, story: [...p.story!, makeBlock('body', '**굵게** *기울임* 각주[^끝 각주]')] };
    const bytes = await exportPdf(syncPages(marked, uid), { hbWasm: async () => readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm') });
    expect(bytes.length).toBeGreaterThan(10000);
  });
});
