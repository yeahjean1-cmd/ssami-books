// 인쇄 사전 검사: 인쇄소에 넘기기 전에 문제가 될 만한 곳을 찾아 위치와 함께 알려 준다.
import { SAFE, bleedOf, computedSpine, coverAsProject, coverGeom } from '../model/cover';
import type { PageElement, Project } from '../model/types';
import { derive, derivedContent } from './flow';
import { effectiveDpi, resolveText } from './render';

export type IssueLevel = 'error' | 'warn' | 'info';

export interface Issue {
  level: IssueLevel;
  text: string;
  /** 어디에 있는 문제인지 (없으면 책 전체) */
  page?: number;
  cover?: boolean;
  elementId?: string;
}

/** 회전을 반영한 요소의 바깥 테두리 */
function bounds(el: PageElement) {
  const a = ((el.rotation ?? 0) * Math.PI) / 180;
  const hw = (Math.abs(el.w * Math.cos(a)) + Math.abs(el.h * Math.sin(a))) / 2;
  const hh = (Math.abs(el.w * Math.sin(a)) + Math.abs(el.h * Math.cos(a))) / 2;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return { l: cx - hw, r: cx + hw, t: cy - hh, b: cy + hh };
}

export function preflight(project: Project): Issue[] {
  const issues: Issue[] = [];
  const bleed = bleedOf(project);
  let rgbImages = 0;
  let transparent = 0;

  const checkSurface = (src: Project, pageIndex: number, where: { page?: number; cover?: boolean }) => {
    const { width: W, height: H } = src.format;
    for (const el of src.pages[pageIndex].elements) {
      const at = { ...where, elementId: el.id };
      const bb = bounds(el);
      if (el.type === 'text') {
        const res = resolveText(el);
        if (res?.layout.overflow) issues.push({ level: 'error', text: '글이 상자보다 길어서 일부가 인쇄되지 않아요.', ...at });
        if (res?.missingFont) issues.push({ level: 'warn', text: `‘${el.style.fontFamily}’ 폰트가 없어 기본 서체로 대체돼요.`, ...at });
        if (el.text.trim() && (bb.l < SAFE || bb.t < SAFE || bb.r > W - SAFE || bb.b > H - SAFE)) {
          issues.push({ level: 'warn', text: `글 상자가 재단선에서 ${SAFE}mm 안쪽(안전 영역)을 벗어나요. 재단할 때 글자가 잘릴 수 있어요.`, ...at });
        }
        continue;
      }
      if (el.type === 'image') {
        const asset = src.assets[el.assetId];
        if (!asset) {
          issues.push({ level: 'error', text: '이미지 원본이 없어요. 이미지를 다시 넣어 주세요.', ...at });
          continue;
        }
        rgbImages++;
        if (el.opacity < 1) transparent++;
        const dpi = Math.round(effectiveDpi(el, asset));
        if (dpi < 150) issues.push({ level: 'error', text: `이미지 해상도가 너무 낮아요(${dpi}dpi). 인쇄하면 깨져 보여요.`, ...at });
        else if (dpi < 250) issues.push({ level: 'warn', text: `이미지 해상도가 낮아요(${dpi}dpi). 300dpi 이상을 권장해요.`, ...at });
      } else if (el.opacity < 1) transparent++;
      // 재단선까지 닿는 그림·도형은 도련까지 넘겨야 재단 오차로 흰 틈이 생기지 않는다
      const short = (edge: number, out: number) => Math.abs(edge) <= 0.5 || (out > 0.5 && out < bleed - 0.05);
      if (short(bb.l, -bb.l) || short(bb.t, -bb.t) || short(bb.r - W, bb.r - W) || short(bb.b - H, bb.b - H)) {
        issues.push({ level: 'warn', text: `재단선까지 닿는 요소는 도련(${bleed}mm)까지 넘겨 주세요. 지금은 재단 후 흰 틈이 보일 수 있어요.`, ...at });
      }
    }
  };

  project.pages.forEach((_, i) => checkSurface(project, i, { page: i }));

  // 본문 흐름
  const d = derive(project);
  d.pagination?.missingFonts.forEach((f) => issues.push({ level: 'warn', text: `본문에 쓰인 ‘${f}’ 폰트가 없어 기본 서체로 대체돼요.` }));
  for (const b of project.story ?? []) if (b.assetId && project.assets[b.assetId]) rgbImages++;
  const blank: number[] = [];
  project.pages.forEach((p, i) => {
    const dc = derivedContent(project, i);
    if (!p.elements.length && !dc.images.length && !dc.texts.some((t) => t.key !== 'pn' && t.key !== 'hd')) blank.push(i + 1);
  });
  if (blank.length) issues.push({ level: 'info', text: `내용이 없는 쪽이 있어요: ${blank.slice(0, 12).join(', ')}${blank.length > 12 ? ' …' : ''}쪽. 의도한 빈 쪽인지 확인해 주세요.`, page: blank[0] - 1 });

  // 쪽수와 제본
  const n = project.pages.length;
  if (project.print.bindingType === 'saddle' && n % 4) {
    issues.push({ level: 'error', text: `중철제본은 쪽수가 4의 배수여야 해요. 지금은 ${n}쪽이라 ${4 - (n % 4)}쪽을 더하거나 줄여야 해요.` });
  } else if (project.print.duplex && n % 2) {
    issues.push({ level: 'info', text: `전체 ${n}쪽으로 홀수예요. 양면 인쇄에서는 마지막에 빈 쪽이 하나 생겨요.` });
  }
  if (bleed < 3) issues.push({ level: 'warn', text: `도련이 ${bleed}mm예요. 대부분의 인쇄소는 3mm 이상을 요구해요.` });

  // 표지
  if (!project.cover) {
    issues.push({ level: 'info', text: '표지가 아직 없어요. ‘표지’ 보기에서 만들 수 있어요.', cover: true });
  } else {
    const src = coverAsProject(project);
    const g = coverGeom(project);
    checkSurface(src, 0, { cover: true });
    const calc = computedSpine(project);
    const over = project.cover.spineOverride;
    if (over !== undefined && Math.abs(over - calc) > 0.5) {
      issues.push({ level: 'info', text: `직접 입력한 책등(${over}mm)이 계산값(${calc}mm, ${n}쪽 기준)과 달라요. 쪽수나 종이가 바뀌었다면 인쇄소에 다시 확인해 주세요.`, cover: true });
    }
    for (const el of src.pages[0].elements) {
      if (!el.spine) continue;
      const bb = bounds(el);
      const at = { cover: true, elementId: el.id };
      if (g.spine < 5) issues.push({ level: 'warn', text: `책등이 ${g.spine}mm로 좁아요. 5mm보다 좁은 책등에는 글자를 넣지 않는 것이 안전해요.`, ...at });
      else if (el.type === 'text' && resolveText(el) && resolveText(el)!.layout.fontSizeMm * 1.1 > g.spine - 2) {
        issues.push({ level: 'warn', text: '책등 글자가 책등 너비에 비해 커요. 제본 오차로 앞·뒤표지로 넘어갈 수 있어요.', ...at });
      } else if (bb.r - bb.l > g.spine + 0.1 && el.type !== 'text') {
        issues.push({ level: 'warn', text: '책등에 놓은 요소가 책등보다 넓어요.', ...at });
      }
    }
  }

  if (rgbImages) issues.push({ level: 'info', text: `이미지 ${rgbImages}개는 RGB(sRGB)로 들어가요. 인쇄소 장비가 CMYK로 바꾸며, 화면보다 색이 조금 차분해질 수 있어요.` });
  if (transparent) issues.push({ level: 'info', text: `투명도를 쓴 요소가 ${transparent}개 있어요. PDF/X-4는 투명도를 지원하지만, 인쇄소가 PDF/X-1a를 요구하면 불투명하게 바꿔 주세요.` });
  if (!project.print.profile) issues.push({ level: 'info', text: '출력 프로파일(ICC)이 없어요. PDF/X-4로 내보내려면 인쇄소가 지정한 CMYK 프로파일을 불러와 주세요.' });

  const order = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}
