import { DEFAULT_TOC, templateCopy } from './templates';
import type { Asset, Block, ImageElement, Margins, Page, PageKind, Project, Rect, StyleName, TextElement, TextStyle } from './types';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const BODY_STYLE: TextStyle = {
  fontFamily: 'Nanum Myeongjo',
  bold: false,
  fontSize: 10,
  lineHeight: 1.75,
  letterSpacing: 0,
  align: 'justify',
  color: '#1f1e1c',
  paraSpacing: 0,
  indent: 3.5,
  wordBreak: 'char',
};

/** 해당 쪽이 펼침면의 오른쪽에 놓이는지. 좌철은 홀수 쪽이 오른쪽이다. */
export function isRightHand(project: Project, pageIndex: number): boolean {
  if (!project.print.duplex) return project.print.binding === 'left';
  const odd = pageIndex % 2 === 0;
  return project.print.binding === 'left' ? odd : !odd;
}

/** 여백 안쪽의 본문 영역 */
export function contentRect(project: Project, pageIndex: number): Rect {
  const { width, height } = project.format;
  const m = project.margins;
  const left = isRightHand(project, pageIndex) ? m.inside : m.outside;
  return { x: left, y: m.top, w: width - m.inside - m.outside, h: height - m.top - m.bottom };
}

export function makeText(rect: Rect, text: string, style: Partial<TextStyle> = {}): TextElement {
  return { id: uid(), type: 'text', ...rect, text, style: { ...BODY_STYLE, ...style } };
}

export function makeImage(rect: Rect, assetId: string): ImageElement {
  return { id: uid(), type: 'image', ...rect, assetId, fit: 'cover', opacity: 1 };
}

export function makePage(kind: PageKind = 'free'): Page {
  return { id: uid(), kind, elements: [] };
}

export function makeBlock(style: StyleName, text: string, extra: Partial<Block> = {}): Block {
  return { id: uid(), style, text, ...extra };
}

export interface NewProjectInput {
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  presetId: string;
  width: number;
  height: number;
  duplex: boolean;
  binding: 'left' | 'right';
  margins: Margins;
  templateId?: string;
  /** 가져온 원고. 없으면 예시 문단으로 시작한다. */
  imported?: { blocks: Block[]; assets: Record<string, Asset> };
}

export function createProject(input: NewProjectInput): Project {
  const now = Date.now();
  const project: Project = {
    version: 1,
    id: uid(),
    createdAt: now,
    updatedAt: now,
    meta: {
      title: input.title.trim() || '제목 없는 책',
      subtitle: input.subtitle.trim(),
      author: input.author.trim(),
      publisher: input.publisher.trim(),
    },
    format: { presetId: input.presetId, width: input.width, height: input.height },
    print: { duplex: input.duplex, binding: input.binding },
    margins: { ...input.margins },
    pages: [],
    assets: { ...input.imported?.assets },
    story: input.imported?.blocks ?? [
      makeBlock('chapter', '첫 번째 장'),
      makeBlock('body', '‘원고’ 보기에서 글을 써 보세요. 글이 길어지면 쪽이 자동으로 늘어나요.'),
    ],
    ...templateCopy(input.templateId),
    toc: { ...DEFAULT_TOC },
  };

  // 1쪽: 속표지
  const titlePage = makePage();
  const c0 = contentRect(project, 0);
  const titleSize = Math.max(16, Math.round(project.format.width / 7));
  const center: Partial<TextStyle> = { align: 'center', indent: 0, wordBreak: 'word' };
  titlePage.elements.push(
    makeText(
      { x: c0.x, y: c0.y + c0.h * 0.22, w: c0.w, h: titleSize * 0.3528 * 1.4 * 2 },
      project.meta.title,
      { ...center, fontSize: titleSize, bold: true, lineHeight: 1.4 },
    ),
  );
  if (project.meta.subtitle) {
    titlePage.elements.push(
      makeText({ x: c0.x, y: c0.y + c0.h * 0.22 + titleSize * 0.3528 * 1.4 * 2 + 4, w: c0.w, h: 12 },
        project.meta.subtitle, { ...center, fontSize: 11, lineHeight: 1.6 }),
    );
  }
  if (project.meta.author) {
    titlePage.elements.push(
      makeText({ x: c0.x, y: c0.y + c0.h * 0.6, w: c0.w, h: 8 }, project.meta.author,
        { ...center, fontSize: 11, lineHeight: 1.6 }),
    );
  }
  if (project.meta.publisher) {
    titlePage.elements.push(
      makeText({ x: c0.x, y: c0.y + c0.h - 8, w: c0.w, h: 8 }, project.meta.publisher,
        { ...center, fontFamily: 'Pretendard', fontSize: 9, lineHeight: 1.6 }),
    );
  }
  titlePage.hideMaster = true;
  project.pages.push(titlePage);

  // 장이 여럿인 원고는 차례 쪽을 넣는다. 본문 쪽은 원고 분량에 맞춰 자동으로 만들어진다(syncPages).
  if (project.story!.filter((b) => b.style === 'chapter').length >= 2) project.pages.push(makePage('toc'));
  project.pages.push(makePage('flow'));
  return project;
}

/** 프로젝트 파일(.bookstudio)을 읽어 검증한다. */
export function parseProjectFile(json: string): Project {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('프로젝트 파일을 읽을 수 없어요. 파일이 손상되었을 수 있어요.');
  }
  if (!data || data.version !== 1 || !Array.isArray(data.pages) || !data.format || !data.margins) {
    throw new Error('Book Studio 프로젝트 파일이 아니에요.');
  }
  return data as Project;
}
