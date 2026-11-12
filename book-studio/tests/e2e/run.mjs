// 실제 브라우저에서 책 만들기 → 편집 → PDF 출력 흐름을 확인한다.
// 사용: npm run build && npx vite preview --port 4173 & node tests/e2e/run.mjs [출력 폴더]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'tests/e2e/out';
fs.mkdirSync(out, { recursive: true });
const assert = (c, m) => { if (!c) throw new Error('실패: ' + m); console.log('  ok', m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://localhost:4173/');
await page.click('#new-book');
await page.fill('#w-title', '느리게 걷는 마음');
await page.fill('#w-subtitle', '어느 산책자의 기록');
await page.fill('#w-author', '김하루');
await page.click('#w-next');
await page.screenshot({ path: path.join(out, '1-wizard-format.png') });
await page.click('[data-preset="kuk"]');
await page.click('[data-preset="shinkuk"]');
await page.click('#w-next');
await page.screenshot({ path: path.join(out, '2-wizard-print.png') });
await page.click('#w-create');
await page.waitForSelector('.editor');
assert((await page.textContent('#page-status')).includes('1 / 2'), '새 책은 속표지와 본문 2쪽으로 시작');

// 2쪽 본문 편집
await page.click('.thumb[data-index="1"]');
const body = page.locator('.page-stage.active .el-hit').first();
await body.dblclick();
const para = '아침 공기가 차가웠다. 그는 “조금만 더 걸어 볼까?” 하고 혼잣말을 했다. 길은 생각보다 길었고(정말로 길었다), 발걸음은 생각보다 가벼웠다. Book Studio 2026년의 첫 산책이었다.';
await page.locator('.text-editor').fill([para, para, para].join('\n'));
await page.click('#canvas', { position: { x: 5, y: 5 } });
assert(await page.locator('.text-editor').count() === 0, '바깥을 누르면 글 편집이 끝남');

// 이미지 넣기
const png = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1200, 800);
  gr.addColorStop(0, '#7a8b72'); gr.addColorStop(1, '#8b6f54'); g.fillStyle = gr; g.fillRect(0, 0, 1200, 800);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(600, 400, 200, 0, 7); g.fill();
  return c.toDataURL('image/png').split(',')[1];
});
fs.writeFileSync(path.join(out, 'sample.png'), Buffer.from(png, 'base64'));
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#add-image')]);
await chooser.setFiles(path.join(out, 'sample.png'));
await page.waitForSelector('#image-dpi');
// 아래쪽 절반으로 크기 조정: 속성 패널에서 직접 입력
const fields = page.locator('#right-panel .grid2 input');
await fields.nth(1).fill('140'); await fields.nth(3).fill('55');
const dpi = parseInt(await page.textContent('#image-dpi'));
assert(dpi > 200 && dpi < 400, `이미지 유효 해상도 표시 (${dpi}dpi)`);

// 끌어서 옮기기 + 실행 취소
const hit = page.locator('.page-stage.active .el-hit').nth(1);
const b0 = await hit.boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down(); await page.mouse.move(b0.x + b0.width / 2 + 30, b0.y + b0.height / 2 - 40, { steps: 5 }); await page.mouse.up();
const b1 = await hit.boundingBox();
assert(Math.abs(b1.x - b0.x - 30) < 1.5 && Math.abs(b1.y - b0.y + 40) < 1.5, '끌어서 요소 이동');
await page.click('#undo');
const b2 = await hit.boundingBox();
assert(Math.abs(b2.x - b0.x) < 0.5 && Math.abs(b2.y - b0.y) < 0.5, '실행 취소 한 번으로 이동 전체가 되돌아감');
await page.click('#redo'); await page.click('#undo');

// 크기 조절 핸들
const se = page.locator('[data-handle="se"]');
const hb = await se.boundingBox();
await page.mouse.move(hb.x + 3, hb.y + 3); await page.mouse.down();
await page.mouse.move(hb.x - 40, hb.y - 10, { steps: 4 }); await page.mouse.up();
const b3 = await hit.boundingBox();
assert(b3.width < b0.width - 30, '핸들로 크기 조절');
await page.click('#undo');

// 글 넘침 감지
await page.click('#add-page');
assert((await page.textContent('#page-status')).includes('3 / 3'), '쪽 추가');
await page.locator('.page-stage.active .el-hit').first().dblclick();
await page.locator('.text-editor').fill(Array(40).fill(para).join('\n'));
await page.click('#canvas', { position: { x: 5, y: 5 } });
await page.locator('.page-stage.active .el-hit').first().click();
assert(await page.locator('#overflow-notice').count() === 1, '글 넘침 경고 표시');
await page.click('#del-page');
assert((await page.textContent('#page-status')).includes('2 / 3') === false && (await page.textContent('#page-status')).includes('/ 2'), '쪽 삭제');

await page.click('.thumb[data-index="1"]');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, '3-editor.png') });

// 화면의 글자 위치(mm) 수집
const screen = await page.evaluate(() => {
  const stage = document.querySelector('.page-stage.active');
  const svg = stage.querySelector('svg');
  const vb = svg.viewBox.baseVal; const r = svg.getBoundingClientRect(); const k = vb.width / r.width;
  return [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim().length > 1).map((t) => {
    const b = t.getBoundingClientRect();
    return { text: t.textContent, x: (b.left - r.left) * k, right: (b.right - r.left) * k, baseline: +t.getAttribute('y') };
  });
});
fs.writeFileSync(path.join(out, 'screen-text.json'), JSON.stringify(screen));

// PDF 내보내기
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-pdf')]);
await dl.saveAs(path.join(out, 'book.pdf'));
assert(fs.statSync(path.join(out, 'book.pdf')).size > 5000, 'PDF 파일 생성');

// 프로젝트 파일 저장
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#save-file')]);
await dl2.saveAs(path.join(out, 'book.bookstudio'));

// 자동 저장 후 새로 고침해도 남아 있는지
await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '저장됨');
await page.reload();
await page.waitForSelector('.project-card');
await page.screenshot({ path: path.join(out, '4-home.png') });
await page.click('.project-card .cover');
await page.waitForSelector('.editor');
await page.click('.thumb[data-index="1"]');
assert(await page.locator('.page-stage.active image').count() === 1, '새로 고침 뒤에도 글과 이미지가 유지됨');

// 프로젝트 파일 다시 열기
await page.click('#go-home');
const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open-file')]);
await ch2.setFiles(path.join(out, 'book.bookstudio'));
await page.waitForSelector('.editor');
assert((await page.inputValue('#project-title')) === '느리게 걷는 마음', '프로젝트 파일을 다시 열 수 있음');

assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
await browser.close();
