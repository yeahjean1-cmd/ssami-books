// 실제 브라우저에서 원고 가져오기 → 자동 조판 → 편집 → PDF 출력 흐름을 확인한다.
// 사용: python3 tests/e2e/make-fixtures.py <폴더>; npm run build && npx vite preview --port 4173 & node tests/e2e/run.mjs <폴더>
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const out = process.argv[2] ?? 'tests/e2e/out';
const f = (name) => path.join(out, name);
const assert = (c, m) => { if (!c) throw new Error('실패: ' + m); console.log('  ok', m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const pageCount = async () => parseInt(await page.textContent('#page-count'));
const pick = async (selector, file) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(selector)]);
  await chooser.setFiles(file);
};
const finishWizard = async (template) => {
  await page.click('#w-next'); await page.click('#w-next'); await page.click('#w-next');
  if (template) await page.click(`.modal [data-template="${template}"]`);
  await page.click('#w-create');
  await page.waitForSelector('.editor');
};
const stat = async (i) => parseInt(await page.locator('#import-stats b').nth(i).textContent());
const para = '아침 공기가 차가웠다. 그는 “조금만 더 걸어 볼까?” 하고 혼잣말을 했다. 길은 생각보다 길었고(정말로 길었다), 발걸음은 생각보다 가벼웠다. ';

await page.goto('http://localhost:4173/');

console.log('1. 새 책 — 원고를 쓰면 쪽이 자동으로 늘어난다');
await page.click('#new-book');
await page.fill('#w-title', '느리게 걷는 마음');
await page.fill('#w-author', '김하루');
await finishWizard();
assert(await pageCount() === 2, '새 책은 속표지 + 본문 1쪽');
await page.click('#view-manuscript');
await page.locator('.ms-row .ms-text').nth(1).click();
await page.locator('textarea.ms-text').fill(para.repeat(30));
assert(await pageCount() > 2, `긴 글을 쓰면 본문 쪽이 자동으로 늘어남 (${await pageCount()}쪽)`);
const grown = await pageCount();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
assert(await page.locator('.ms-row').count() === 3, 'Enter로 문단 나누기');
await page.keyboard.type('새 문단입니다.');
await page.keyboard.press('Home');
await page.keyboard.press('Backspace');
assert(await page.locator('.ms-row').count() === 2, '문단 맨 앞 Backspace로 앞 문단과 합치기');
await page.locator('textarea.ms-text').fill('짧은 글.');
assert(await pageCount() === 2, `글을 줄이면 쪽도 줄어듦 (${grown} → 2쪽)`);
await page.click('#view-pages');

console.log('2. 자유 배치 쪽 (Phase 1 기능)');
await page.click('#add-page');
assert(await pageCount() === 3, '글 상자 쪽 추가');
await page.locator('.page-stage.active .el-hit').first().dblclick();
await page.locator('.text-editor').fill(Array(40).fill(para).join('\n'));
await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.locator('.page-stage.active .el-hit').first().click();
assert(await page.locator('#overflow-notice').count() === 1, '글 상자의 글 넘침 경고');
const png = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
  const g = c.getContext('2d'); g.fillStyle = '#7a8b72'; g.fillRect(0, 0, 1200, 800);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(600, 400, 200, 0, 7); g.fill();
  return c.toDataURL('image/png').split(',')[1];
});
fs.writeFileSync(f('sample.png'), Buffer.from(png, 'base64'));
await pick('#add-image', f('sample.png'));
await page.waitForSelector('#image-dpi');
const hit = page.locator('.page-stage.active .el-hit').nth(1);
const b0 = await hit.boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down(); await page.mouse.move(b0.x + b0.width / 2 + 30, b0.y + b0.height / 2 - 40, { steps: 5 }); await page.mouse.up();
const b1 = await hit.boundingBox();
assert(Math.abs(b1.x - b0.x - 30) < 1.5 && Math.abs(b1.y - b0.y + 40) < 1.5, '끌어서 요소 이동');
await page.click('#undo');
const b2 = await hit.boundingBox();
assert(Math.abs(b2.x - b0.x) < 0.5, '실행 취소');
await page.click('#del-page');
assert(await pageCount() === 2, '쪽 삭제');
await page.click('#go-home');

console.log('3. TXT 원고 가져오기 → 자동 조판');
await pick('#import-file', f('manuscript.txt'));
await page.waitForSelector('#import-stats');
assert(await stat(0) === 6 && await stat(1) === 6, '장 제목 6개, 절 제목 6개를 찾음');
await page.screenshot({ path: f('1-import-preview.png') });
await page.click('#import-next');
assert(await page.inputValue('#w-title') === 'manuscript', '파일 이름을 책 제목으로 제안');
await page.fill('#w-title', '느리게 걷는 마음');
await page.fill('#w-author', '김하루');
await page.click('#w-next'); await page.click('#w-next'); await page.click('#w-next');
await page.screenshot({ path: f('2-wizard-template.png') });
await page.click('#w-create');
await page.waitForSelector('.editor');
const total = await pageCount();
assert(total > 30, `원고 분량에 맞춰 쪽 자동 생성 (${total}쪽)`);
assert((await page.textContent('.thumb[data-index="1"]')).includes('차례'), '차례 쪽 자동 추가');
await page.click('.thumb[data-index="1"]');
await page.screenshot({ path: f('3-toc.png') });
await page.click('.thumb[data-index="3"]');
await page.waitForTimeout(200);
await page.screenshot({ path: f('4-flow.png') });

// 문단 스타일을 고치면 책 전체가 다시 조판된다
await page.locator('.page-stage.active .block-hit').nth(2).click();
assert((await page.inputValue('#block-style')) === 'body', '본문 문단을 누르면 문단 속성 표시');
await page.fill('#font-size', '12');
const bigger = await pageCount();
assert(bigger > total, `본문 글자를 키우면 책 전체가 다시 조판됨 (${total} → ${bigger}쪽)`);
await page.click('#undo');
assert(await pageCount() === total, '실행 취소로 원래 쪽수로');

// 사용자가 고정한 쪽 나눔
await page.locator('.page-stage.active .block-hit').nth(2).click();
const blockId = await page.locator('.page-stage.active .block-hit').nth(2).getAttribute('data-block');
await page.check('#block-break');
const first = await page.locator('.page-stage.active .block-hit').first().getAttribute('data-block');
assert(await page.locator(`.page-stage.active [data-block="${blockId}"]`).count() === 0 || first === blockId, '‘새 쪽에서 시작’으로 고정한 문단이 다음 쪽 맨 위로 이동');
await page.click('#undo');

// 템플릿 적용
await page.click('#canvas', { position: { x: 5, y: 5 } });
page.once('dialog', (d) => d.accept());
await page.click('#right-panel [data-template="practical"]');
const practical = await pageCount();
assert(practical !== total, `템플릿을 바꾸면 다시 조판됨 (${total} → ${practical}쪽)`);
await page.click('#undo');
assert(await pageCount() === total, '템플릿 적용도 실행 취소 가능');

// PDF: 쪽수, 차례의 쪽 번호와 실제 위치
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-pdf')]);
await dl.saveAs(f('book.pdf'));
const info = execSync(`pdfinfo "${f('book.pdf')}"`).toString();
assert(parseInt(/Pages:\s+(\d+)/.exec(info)[1]) === total, `PDF 쪽수 = 편집 화면 쪽수 (${total})`);
const tocText = execSync(`pdftotext -f 2 -l 2 -layout "${f('book.pdf')}" -`).toString();
const m = /제3장 오래된 서점[\s·.]*(\d+)/.exec(tocText);
assert(m, '차례에 장 제목과 쪽 번호가 있음');
const target = execSync(`pdftotext -f ${m[1]} -l ${m[1]} "${f('book.pdf')}" -`).toString();
assert(target.includes('제3장 오래된 서점') && target.trim().endsWith(m[1]), `차례의 쪽 번호(${m[1]})에 실제로 그 장이 있고, 쪽 번호도 ${m[1]}로 찍힘`);
execSync(`pdftoppm -f 4 -l 5 -r 70 -png "${f('book.pdf')}" "${f('pdf')}"`);

// 저장 후 새로 고침
await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '저장됨');
await page.reload();
await page.waitForSelector('.project-card');
await page.click('.project-card .cover');
await page.waitForSelector('.editor');
assert(await pageCount() === total, '새로 고침 뒤에도 같은 쪽수로 열림');
await page.click('#go-home');

console.log('4. Word(DOCX) 가져오기');
await pick('#import-file', f('manuscript.docx'));
await page.waitForSelector('#import-stats');
assert(await stat(0) === 2 && await stat(1) === 1 && await stat(3) === 1, 'Word 제목 스타일 → 장 2·절 1, 이미지 1개');
const warn = await page.textContent('.modal .notice');
assert(warn.includes('굵게') && warn.includes('표 1개'), '잃은 서식(굵게, 표)을 미리 알림');
await page.click('#import-next');
await finishWizard('novel');
const docxPages = await pageCount();
let foundImage = false;
for (let i = 0; i < docxPages && !foundImage; i++) {
  await page.click(`.thumb[data-index="${i}"]`);
  foundImage = (await page.locator('.page-stage.active svg > image').count()) > 0;
}
assert(foundImage, '문서 안의 이미지가 본문 흐름에 들어감');
await page.screenshot({ path: f('5-docx.png') });
await page.click('#go-home');

console.log('5. 한글(HWPX·HWP) 가져오기');
await pick('#import-file', f('manuscript.hwpx'));
await page.waitForSelector('#import-stats');
assert(await stat(0) === 1 && await stat(1) === 1 && await stat(2) === 4, 'HWPX: 개요 1 → 장, 개요 2 → 절, 표 안의 글 포함 본문 4문단');
await page.click('.modal .btn.ghost');
if (fs.existsSync(f('sample.hwp'))) {
  await pick('#import-file', f('sample.hwp'));
  await page.waitForSelector('#import-stats');
  assert(await stat(2) > 5, `HWP 5.0 실제 파일에서 본문 ${await stat(2)}문단을 읽음`);
  await page.click('#import-next');
  await finishWizard();
  assert(await pageCount() >= 2, 'HWP 원고로 책 생성');
  await page.click('#go-home');
} else console.log('  (sample.hwp가 없어 HWP 실제 파일 확인은 건너뜀)');
fs.writeFileSync(f('bad.docx'), 'not a docx');
await pick('#import-file', f('bad.docx'));
await page.waitForSelector('.toast.error');
assert((await page.textContent('.toast.error')).includes('Word 파일을 읽지 못했어요'), '손상된 파일은 오류로 안내');

assert(errors.filter((e) => !e.includes('zip')).length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
await browser.close();
