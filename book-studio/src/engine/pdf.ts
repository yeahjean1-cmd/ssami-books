// 일반 PDF 출력. 화면을 캡처하지 않고 문서 모델과 조판 결과를 PDF 연산자로 직접 그린다.
import {
  PDFDocument, PDFFont, PDFImage, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb,
  setCharacterSpacing,
} from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';
import type { Asset, Project } from '../model/types';
import { derivedContent, type PlacedText } from './flow';
import type { LoadedFont } from './fonts';
import type { Line } from './layout';
import { imageDrawRect, resolveText } from './render';
import { subsetFont, type WasmSource } from './subset';
import { MM_TO_PT, hexToRgb } from './units';

const fontkit: any = (fontkitNs as any).default ?? fontkitNs;

export type Rasterize = (asset: Asset) => Promise<Uint8Array>;

function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** JPG·PNG 외의 이미지를 PNG로 변환한다(브라우저 전용). */
export const browserRasterize: Rasterize = async (asset) => {
  const img = new Image();
  img.src = asset.dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = asset.pxW;
  canvas.height = asset.pxH;
  canvas.getContext('2d')!.drawImage(img, 0, 0, asset.pxW, asset.pxH);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 변환하지 못했어요.'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
};

export interface ExportOptions {
  /** JPG·PNG가 아닌 이미지를 PNG로 바꾸는 함수 */
  rasterize?: Rasterize;
  /** hb-subset.wasm 로더. 없으면 폰트 전체를 포함한다(파일이 커진다). */
  hbWasm?: WasmSource;
}

export async function exportPdf(project: Project, { rasterize, hbWasm }: ExportOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(project.meta.title);
  if (project.meta.author) doc.setAuthor(project.meta.author);
  doc.setCreator('Book Studio');
  doc.setProducer('Book Studio');

  const k = MM_TO_PT;
  const W = project.format.width * k;
  const H = project.format.height * k;
  const fonts = new Map<string, PDFFont>();
  const images = new Map<string, PDFImage>();

  // 쪽마다 그릴 글을 모은다: 자동 조판된 글(본문·목차·쪽 번호) + 자유 배치 글 상자
  interface TextDraw { x: number; y: number; lines: Line[]; font: LoadedFont; size: number; color: string }
  const pageTexts: TextDraw[][] = project.pages.map((page, i) => {
    const list: TextDraw[] = derivedContent(project, i).texts.map((t: PlacedText) => ({ x: t.x, y: t.y, lines: t.lines, font: t.font, size: t.fontSize, color: t.color }));
    for (const el of page.elements) {
      if (el.type !== 'text') continue;
      const res = resolveText(el);
      if (res) list.push({ x: el.x, y: el.y, lines: res.layout.lines, font: res.font, size: el.style.fontSize, color: el.style.color });
    }
    return list;
  });

  // 폰트별로 실제 쓰인 글자를 모아 그 글자만 담은 폰트를 PDF에 포함한다.
  const used = new Map<string, { data: Uint8Array; cps: Set<number> }>();
  for (const list of pageTexts) {
    for (const t of list) {
      let u = used.get(t.font.key);
      if (!u) used.set(t.font.key, (u = { data: t.font.data, cps: new Set([32]) }));
      for (const line of t.lines) for (const run of line.runs) for (const ch of run.text) u.cps.add(ch.codePointAt(0)!);
    }
  }
  for (const [key, u] of used) {
    const data = hbWasm ? await subsetFont(u.data, u.cps, hbWasm) : u.data;
    fonts.set(key, await doc.embedFont(data, { subset: false, features: { liga: false, kern: false } }));
  }

  const embedImage = async (asset: Asset): Promise<PDFImage> => {
    let img = images.get(asset.id);
    if (!img) {
      if (asset.mime === 'image/jpeg') img = await doc.embedJpg(dataUrlBytes(asset.dataUrl));
      else if (asset.mime === 'image/png') img = await doc.embedPng(dataUrlBytes(asset.dataUrl));
      else if (rasterize) img = await doc.embedPng(await rasterize(asset));
      else throw new Error(`지원하지 않는 이미지 형식이에요: ${asset.name}`);
      images.set(asset.id, img);
    }
    return img;
  };

  for (const [pageIndex, page] of project.pages.entries()) {
    const out = doc.addPage([W, H]);
    for (const im of derivedContent(project, pageIndex).images) {
      const asset = project.assets[im.assetId];
      if (!asset) continue;
      const r = im.rect;
      out.drawImage(await embedImage(asset), { x: r.x * k, y: H - (r.y + r.h) * k, width: r.w * k, height: r.h * k });
    }
    for (const el of page.elements) {
      if (el.type !== 'image') continue;
      const asset = project.assets[el.assetId];
      if (!asset) continue;
      const img = await embedImage(asset);
      const r = imageDrawRect(el, asset);
      out.pushOperators(pushGraphicsState(), rectangle(el.x * k, H - (el.y + el.h) * k, el.w * k, el.h * k), clip(), endPath());
      out.drawImage(img, { x: r.x * k, y: H - (r.y + r.h) * k, width: r.w * k, height: r.h * k, opacity: el.opacity });
      out.pushOperators(popGraphicsState());
    }
    for (const t of pageTexts[pageIndex]) {
      const font = fonts.get(t.font.key)!;
      const [r, g, b] = hexToRgb(t.color);
      for (const line of t.lines) {
        for (const run of line.runs) {
          out.pushOperators(setCharacterSpacing(run.ls * k));
          out.drawText(run.text, { x: (t.x + run.x) * k, y: H - (t.y + line.baseline) * k, size: t.size, font, color: rgb(r, g, b) });
        }
      }
    }
    out.pushOperators(setCharacterSpacing(0));
  }
  return doc.save();
}
