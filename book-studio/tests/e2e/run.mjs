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
assert(await page.locator('#right-panel.simple').count() === 1 && !(await page.isVisible('#baseline-grid')), '처음에는 ‘간단히’ 모드: 세부 설정은 숨김');
await page.click('#mode-expert');
assert(await page.isVisible('#baseline-grid'), '‘자세히’ 모드에서 세부 설정 표시');
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
await page.keyboard.down('Alt'); // 달라붙기 끄고 정확히 옮긴다
await page.mouse.down(); await page.mouse.move(b0.x + b0.width / 2 + 30, b0.y + b0.height / 2 - 40, { steps: 5 }); await page.mouse.up();
await page.keyboard.up('Alt');
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
await page.click('#right-panel [data-template="practical"]');
await page.click('#confirm-ok');
const practical = await pageCount();
assert(practical !== total, `템플릿을 바꾸면 다시 조판됨 (${total} → ${practical}쪽)`);
await page.click('#undo');
assert(await pageCount() === total, '템플릿 적용도 실행 취소 가능');

// PDF: 쪽수, 차례의 쪽 번호와 실제 위치
await page.click('#export-pdf');
assert(await page.isDisabled('#ex-cover'), '표지가 없으면 표지 내보내기는 꺼져 있음');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ex-run')]);
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
assert(warn.includes('표 1개') && !warn.includes('굵게·기울임·밑줄'), '잃는 서식(표)을 미리 알림');
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
await page.click('#view-manuscript');
assert((await page.locator('#manuscript b').allTextContents()).includes('천천히 걷는 사람') && !(await page.textContent('#manuscript .ms-sheet .ms-row')).includes('**'), 'Word의 굵은 글자를 가져오고, 원고 보기에서 기호 없이 굵게 보임');
await page.click('#view-pages');
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

await page.waitForSelector('.toast.error', { state: 'detached', timeout: 10000 });

console.log('6. 표지와 책등');
await page.locator('.project-card', { hasText: '32쪽' }).first().locator('.cover').click();
await page.waitForSelector('.editor');
await page.click('#view-cover');
await page.waitForSelector('#cover-empty');
await page.screenshot({ path: f('8-cover-empty.png') });
await page.click('#cover-empty [data-cover-template="band"]');
await page.waitForSelector('#cover-size');
assert((await page.textContent('#cover-size')).includes('책등 1.6mm'), '책등 자동 계산: 32쪽 ÷ 2 × 0.1mm = 1.6mm');
assert((await page.textContent('#cover-size')).includes('305.6 × 225'), '표지 펼친 크기 = 뒤표지 + 책등 + 앞표지');
await page.selectOption('#paper', 'elight80');
assert((await page.textContent('#spine-calc')).startsWith('2.1mm'), '종이를 바꾸면 책등 다시 계산 (0.13mm → 2.1mm)');
const titleBox = async () => (await page.locator('.page-stage .el-hit').nth(1).boundingBox());
const stageBox = async () => (await page.locator('.page-stage svg').first().boundingBox());
const t0 = await titleBox(); const s0 = await stageBox();
await page.check('#spine-manual');
await page.fill('#spine-override', '12');
assert((await page.textContent('#cover-size')).includes('책등 12mm') && (await page.textContent('#cover-size')).includes('316 × 225'), '인쇄소 책등 값 직접 입력 → 표지 크기 변경');
const t1 = await titleBox(); const s1 = await stageBox();
const mmPx = s1.width / (316 + 6);
assert(Math.abs((s1.x + s1.width - (t1.x + t1.width)) / mmPx - (s0.x + s0.width - (t0.x + t0.width)) / (s0.width / (306.1 + 6))) < 0.3, '책등이 넓어져도 앞표지 제목은 앞표지 안 같은 자리에 있음');

// 표지 요소 편집
await page.locator('.page-stage .el-hit').nth(1).dblclick();
await page.locator('.text-editor').fill('느리게 걷는 마음');
await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.click('#add-rect');
assert(await page.locator('#rect-fill').count() === 1, '표지에 도형 추가');
await page.keyboard.press('Delete');
await page.screenshot({ path: f('9-cover.png') });

console.log('7. 사전 검사');
await page.fill('#spine-override', '3');
await page.click('#preflight-status');
await page.waitForSelector('#preflight');
const spineIssue = page.locator('.issue', { hasText: '책등이 3mm로 좁아요' });
assert(await spineIssue.count() === 1, '좁은 책등에 놓인 글자를 경고');
await page.screenshot({ path: f('10-preflight.png') });
await spineIssue.click();
assert(await page.locator('#preflight').count() === 0 && await page.locator('#font-size').count() === 1, '검사 항목을 누르면 표지의 해당 요소가 선택됨');
await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.fill('#spine-override', '12');
// 내지: 글 넘침 오류 → 해당 쪽으로 이동
await page.click('#view-pages');
await page.click('.thumb[data-index="0"]');
await page.click('#add-text');
await page.locator('.text-editor').fill(Array(30).fill(para).join('\n'));
await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.click('.thumb[data-index="2"]');
assert((await page.textContent('#preflight-status')).includes('오류 1'), '상태 표시줄에 오류 수 표시');
await page.click('#preflight-status');
await page.locator('.issue.error').first().click();
assert((await page.textContent('#page-status')).startsWith('1 /') && await page.locator('#overflow-notice').count() === 1, '오류 항목을 누르면 그 쪽으로 이동하고 요소가 선택됨');
await page.keyboard.press('Delete');
assert((await page.textContent('#preflight-status')).includes('오류 0'), '고치면 오류가 사라짐');
const w0 = (await page.locator('.page-stage.active svg').boundingBox()).width;
await page.check('#show-bleed');
assert((await page.locator('.page-stage.active svg').boundingBox()).width > w0 * 1.02, '내지에서 도련 영역 보기');
await page.uncheck('#show-bleed');

console.log('8. 인쇄용 PDF');
const downloads = [];
page.on('download', (d) => downloads.push(d));
const exportAll = async (prefix) => {
  downloads.length = 0;
  await page.click('#ex-run');
  await page.waitForSelector('#export-dialog', { state: 'detached', timeout: 60000 });
  for (let i = 0; i < 50 && downloads.length < 2; i++) await page.waitForTimeout(100);
  // 내지 → 표지 순서로 내려받는다. (이 시험용 브라우저는 한글 파일 이름을 'download'로 바꾸므로 순서로 구분한다)
  const files = {};
  for (const [i, d] of downloads.entries()) { const key = i === 0 ? 'interior' : 'cover'; const to = f(`${prefix}${key}.pdf`); await d.saveAs(to); files[key] = { to }; }
  return files;
};
const boxes = (file) => execSync(`pdfinfo -box "${file}"`).toString();
const pt = (v) => (v * 72) / 25.4;
await page.click('#export-pdf');
await page.click('#export-dialog [data-preset="print"]');
assert(await page.isDisabled('#ex-pdfx'), '출력 프로파일이 없으면 PDF/X-4를 고를 수 없음');
const printed = await exportAll('print-');
assert(printed.cover && printed.interior, '내지와 표지를 각각의 파일로 내보냄');
const cb = boxes(printed.cover.to);
const trim = /TrimBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(cb).slice(1).map(Number);
const bleedB = /BleedBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(cb).slice(1).map(Number);
assert(Math.abs(trim[2] - trim[0] - pt(316)) < 0.1 && Math.abs(trim[3] - trim[1] - pt(225)) < 0.1, '표지 PDF의 재단 크기 = 316 × 225mm');
assert(Math.abs(trim[0] - bleedB[0] - pt(3)) < 0.1, '도련 3mm');
const ib = boxes(printed.interior.to);
assert(/Pages:\s+32/.test(ib) && Math.abs(parseFloat(/TrimBox:\s+[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(ib)[1]) - parseFloat(/TrimBox:\s+([\d.]+)/.exec(ib)[1]) - pt(152)) < 0.1, '내지 PDF: 32쪽, 재단 크기 152mm');
execSync(`pdftoppm -r 60 -png "${printed.cover.to}" "${f('print-cover')}"`);

// 인쇄소 출력 프로파일 → PDF/X-4
const icc = fs.readFileSync('tests/fixtures/CGATS001Compat-v2-micro.icc');
fs.writeFileSync(f('not-output.icc'), icc);
const prtr = Buffer.from(icc); prtr.write('prtr', 12, 'latin1');
fs.writeFileSync(f('printer.icc'), prtr);
await page.click('#tab-print');
await pick('#load-profile', f('not-output.icc'));
await page.waitForSelector('.toast.error');
assert((await page.textContent('#profile-name')) === '없음', '출력 장치용이 아닌 프로파일은 거부');
await pick('#load-profile', f('printer.icc'));
await page.waitForFunction(() => document.querySelector('#profile-name')?.textContent !== '없음');
await page.click('#export-pdf');
await page.click('#export-dialog [data-preset="print"]');
assert(await page.isChecked('#ex-pdfx'), '프로파일을 불러오면 PDF/X-4 사용 가능');
const x4 = await exportAll('x4-');
const raw = fs.readFileSync(x4.interior.to).toString('latin1');
assert(raw.includes('/GTS_PDFXVersion (PDF/X-4)') && raw.includes('/OutputIntents') && raw.includes('/DefaultRGB'), 'PDF/X-4 정보(버전, 출력 인텐트, RGB 색 공간)가 들어감');
assert(/Pages:\s+32/.test(execSync(`pdfinfo "${x4.interior.to}"`).toString()) && execSync(`pdftotext -f 3 -l 3 "${x4.interior.to}" -`).toString().includes('프롤로그'), 'PDF/X-4 파일이 정상적으로 열리고 글이 들어 있음');
await page.click('#export-pdf');
await page.click('#export-dialog [data-preset="proof"]');
const proof = await exportAll('proof-');
assert(/TrimBox/.test(boxes(proof.interior.to)) && !fs.readFileSync(proof.interior.to).toString('latin1').includes('GTS_PDFX'), '검수용 PDF: 도련·재단선 포함, PDF/X 정보 없음');


console.log('9. 글자 서식·각주·기준선 격자·공통 요소·레이어·3D 미리보기');
await page.click('#view-manuscript');
await page.locator('.ms-row .ms-text').nth(1).click();
await page.locator('textarea.ms-text').fill('그는 천천히 걸었다. Walden을 읽었다. ' + para.repeat(2));
await page.locator('textarea.ms-text').evaluate((t) => t.setSelectionRange(3, 6));
await page.keyboard.press('Control+b');
assert((await page.inputValue('textarea.ms-text')).startsWith('그는 **천천히** 걸었다'), 'Ctrl+B로 고른 글을 굵게');
await page.locator('textarea.ms-text').fill('그는 **천천히** 걸었다. *Walden*[^소로의 책, 1854년.]을 읽었다. ' + para.repeat(2));
await page.click('#view-pages');
await page.click('.thumb[data-index="2"]');
const marks = await page.evaluate(() => {
  const texts = [...document.querySelectorAll('.page-stage.active svg text')];
  const find = (t) => texts.find((x) => x.textContent === t);
  return {
    bold: find('천천히')?.getAttribute('font-weight'), italic: find('Walden')?.getAttribute('transform') ?? '',
    note: texts.some((x) => x.textContent.startsWith('1 소로의 책')), raw: texts.some((x) => x.textContent.includes('**') || x.textContent.includes('[^')),
  };
});
assert(marks.bold === '700' && marks.italic.includes('skewX') && marks.note && !marks.raw, '본문에 굵게·기울임이 적용되고, 각주가 같은 쪽 아래에 번호와 함께 놓임');
await page.screenshot({ path: f('11-footnote.png') });

await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.click('#tab-design');
await page.check('#baseline-grid');
assert(await page.locator('.page-stage.active #baseline-grid').count() === 1, '기준선 격자 켜기');
await page.check('#pn-restart');
await page.fill('#tpl-name', '내 에세이');
await page.locator('.name-save', { has: page.locator('#tpl-name') }).locator('button').click();
assert(await page.locator('#my-templates > div').count() === 1, '지금 디자인을 내 템플릿으로 저장');
await page.uncheck('#pn-restart');

await page.click('#view-master');
await page.click('#add-rect');
await page.click('#tab-layers');
assert(await page.locator('.layer').count() === 1, '레이어 목록에 공통 요소가 보임');
await page.click('#view-pages');
const sage = () => page.locator('.page-stage.active svg > rect[fill="#7a8b72"]').count();
assert(await sage() === 1, '공통 요소가 본문 쪽에 깔림');
await page.locator('.statusbar button[aria-label="이전 쪽"]').click(); await page.locator('.statusbar button[aria-label="이전 쪽"]').click();
assert((await page.textContent('#page-status')).startsWith('1 /') && await sage() === 0, '공통 요소를 숨긴 속표지에는 나오지 않음');
await page.click('#view-master');
await page.click('.layer [data-act="hide"]');
assert(await page.locator('.page-stage svg > rect[fill="#7a8b72"]').count() === 0, '레이어 숨기기');
await page.click('.layer [data-act="hide"]');
await page.click('.layer [data-act="lock"]');
await page.click('.layer');
await page.keyboard.press('Delete');
assert(await page.locator('.layer').count() === 1, '잠근 요소는 지워지지 않음');
await page.click('.layer [data-act="lock"]');
await page.keyboard.press('Delete');
assert(await page.locator('.layer').count() === 0, '잠금을 풀면 지울 수 있음');

await page.click('#open-preview');
await page.waitForSelector('#book3d');
const a0 = await page.getAttribute('#book3d', 'data-angle');
const sb = await page.locator('.stage3d').boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down(); await page.mouse.move(sb.x + sb.width / 2 + 60, sb.y + sb.height / 2, { steps: 4 }); await page.mouse.up();
assert(await page.getAttribute('#book3d', 'data-angle') !== a0, '3D 책 미리보기를 끌어서 돌림');
await page.screenshot({ path: f('12-preview3d.png') });
await page.click('#book-preview .btn.primary');

await page.click('#export-pdf');
await page.uncheck('#ex-cover');
downloads.length = 0;
await page.click('#ex-run');
await page.waitForSelector('#export-dialog', { state: 'detached', timeout: 60000 });
for (let i = 0; i < 50 && !downloads.length; i++) await page.waitForTimeout(100);
await downloads[0].saveAs(f('styled.pdf'));
const p3 = execSync(`pdftotext -f 3 -l 3 "${f('styled.pdf')}" -`).toString();
assert(p3.includes('천천히') && p3.includes('소로의 책, 1854년.') && !p3.includes('**'), 'PDF에도 서식과 각주가 들어감');
execSync(`pdftoppm -f 3 -l 3 -r 80 -png "${f('styled.pdf')}" "${f('styled')}"`);

console.log('10. 도형·회전, 이전 버전, 도움말, RTF');
await page.click('#view-pages');
await page.click('.tabs button:first-child');
await page.click('.thumb[data-index="0"]');
await page.click('#add-rect');
await page.locator('#right-panel .segmented button', { hasText: '원' }).click();
assert(await page.locator('.page-stage.active svg > ellipse').count() === 1, '원 도형');
await page.fill('#rotation', '30');
assert(((await page.locator('.page-stage.active svg > ellipse').getAttribute('transform')) ?? '').startsWith('rotate(30'), '자유 각도 회전');
await page.keyboard.press('Escape');
await page.locator('.page-stage.active .el-hit').last().click();
await page.keyboard.press('Delete');
assert(await page.locator('.page-stage.active svg > ellipse').count() === 0, '도형 삭제');
await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.check('#notes-book');
await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '저장됨');
await page.click('#tab-doc');
await page.waitForSelector('#versions > div'); // 목록은 탭을 연 뒤 불러온다
assert(await page.locator('#versions > div').count() >= 1, '책을 열 때 남긴 복원 지점이 ‘이전 버전’에 보임');
await page.click('#more');
await page.click('#open-help');
assert((await page.textContent('#help')).includes('인쇄소에 넘기기'), '사용 안내');
await page.click('#help .btn.primary');
await page.click('#go-home');
fs.writeFileSync(f('m.rtf'), "{\\rtf1\\ansi{\\fonttbl{\\f0 Batang;}}\\uc1 \\u51228?1\\u51109? \\u49884?\\u51089?\\par \\u48376?\\u47928?\\u51077?\\u45768?\\u45796?.\\par}");
await pick('#import-file', f('m.rtf'));
await page.waitForSelector('#import-stats');
assert(await stat(0) === 1 && await stat(2) === 1 && (await page.textContent('.import-list')).includes('제1장 시작'), 'RTF 원고 가져오기');
await page.click('.modal .btn.ghost');

assert(errors.filter((e) => !e.includes('zip')).length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
await browser.close();
