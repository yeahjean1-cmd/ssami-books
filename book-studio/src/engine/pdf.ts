// PDF 출력. 화면을 캡처하지 않고 문서 모델과 조판 결과를 PDF 연산자로 직접 그린다.
// 화면용(완성 크기·RGB)과 인쇄용(도련·재단선·CMYK·PDF/X-4)을 같은 그리기 경로로 만든다.
import {
  PDFDocument, PDFFont, PDFHexString, PDFImage, PDFName, PDFPage, PDFString, clip, cmyk, concatTransformationMatrix, degrees, endPath,
  popGraphicsState, pushGraphicsState, rectangle, rgb, setCharacterSpacing, type Color,
} from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';
import { bleedOf, coverAsProject } from '../model/cover';
import type { Asset, PageElement, Project } from '../model/types';
import { derivedContent } from './flow';
import type { LoadedFont } from './fonts';
import { SUP_RISE, SUP_SCALE, type Line } from './layout';
import { PT_TO_MM } from './units';
import { imageDrawRect, resolveText } from './render';
import { subsetFont, type WasmSource } from './subset';
import { MM_TO_PT, hexToRgb } from './units';

const fontkit: any = (fontkitNs as any).default ?? fontkitNs;

export type Rasterize = (asset: Asset) => Promise<Uint8Array>;

export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const dataUrlBytes = (dataUrl: string) => base64Bytes(dataUrl.slice(dataUrl.indexOf(',') + 1));

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
  /** 내지 또는 표지 */
  target?: 'interior' | 'cover';
  /** 도련 포함 */
  bleed?: boolean;
  /** 재단선 표시 (도련을 포함할 때만) */
  marks?: boolean;
  /** 글자·도형 색을 CMYK로 (검정 글자는 먹 1도) */
  cmyk?: boolean;
  /** PDF/X-4 정보(출력 인텐트 등)를 넣는다. 프로젝트에 출력 프로파일이 있어야 한다. */
  pdfx?: boolean;
  /** sRGB ICC 프로파일: PDF/X-4에서 RGB 이미지에 색 공간을 지정하는 데 쓴다 */
  srgbProfile?: Uint8Array;
  rasterize?: Rasterize;
  /** hb-subset.wasm 로더. 없으면 폰트 전체를 포함한다(파일이 커진다). */
  hbWasm?: WasmSource;
}

/** RGB → CMYK. 무채색은 먹(K)만 써서 글자가 4도 겹침 인쇄로 번지지 않게 한다. */
export function toCmyk(hex: string): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  if (max - Math.min(r, g, b) < 0.02) return [0, 0, 0, 1 - (r + g + b) / 3];
  const k = 1 - max;
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

const MARK_GAP = 2; // 도련과 재단선 표시 사이 mm
const MARK_LEN = 5;

interface TextDraw { x: number; y: number; lines: Line[]; font: LoadedFont; fontBold?: LoadedFont; size: number; color: string; el?: PageElement }

export async function exportPdf(project: Project, opts: ExportOptions = {}): Promise<Uint8Array> {
  const { rasterize, hbWasm } = opts;
  const isCover = opts.target === 'cover';
  if (isCover && !project.cover) throw new Error('표지가 아직 없어요.');
  const src = isCover ? coverAsProject(project) : project;
  const background = isCover ? project.cover!.background : null;
  const profile = project.print.profile;
  if (opts.pdfx && !profile) throw new Error('PDF/X-4로 내보내려면 인쇄소의 출력 프로파일(ICC)을 먼저 불러와 주세요.');

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(isCover ? `${project.meta.title} (표지)` : project.meta.title);
  if (project.meta.author) doc.setAuthor(project.meta.author);
  doc.setCreator('Book Studio');
  doc.setProducer('Book Studio');

  const k = MM_TO_PT;
  const bleed = opts.bleed ? bleedOf(project) : 0;
  const pad = bleed + (opts.bleed && opts.marks ? MARK_GAP + MARK_LEN + 1 : 0); // 재단 크기 바깥 여유 mm
  const W = src.format.width * k;
  const H = src.format.height * k;
  const color = (hex: string): Color => (opts.cmyk ? cmyk(...toCmyk(hex)) : rgb(...hexToRgb(hex)));

  // 쪽마다 그릴 요소: 공통 요소(마스터)를 먼저 깔고 그 위에 쪽 요소를 놓는다. 숨긴 요소는 뺀다.
  const pageEls: PageElement[][] = src.pages.map((page) =>
    [...(page.hideMaster ? [] : src.masterElements ?? []), ...page.elements].filter((el) => !el.hidden));
  const pageTexts: TextDraw[][] = src.pages.map((_, i) => {
    const list: TextDraw[] = derivedContent(src, i).texts.map((t) => ({ x: t.x, y: t.y, lines: t.lines, font: t.font, fontBold: t.fontBold, size: t.fontSize, color: t.color }));
    for (const el of pageEls[i]) {
      if (el.type !== 'text') continue;
      const res = resolveText(el);
      if (res) list.push({ x: el.x, y: el.y, lines: res.layout.lines, font: res.font, fontBold: res.fontBold, size: el.style.fontSize, color: el.style.color, el });
    }
    return list;
  });

  // 폰트별로 실제 쓰인 글자를 모아 그 글자만 담은 폰트를 PDF에 포함한다.
  const used = new Map<string, { data: Uint8Array; cps: Set<number> }>();
  for (const list of pageTexts) {
    for (const t of list) {
      for (const line of t.lines) {
        for (const run of line.runs) {
          const f = run.b && t.fontBold ? t.fontBold : t.font;
          let u = used.get(f.key);
          if (!u) used.set(f.key, (u = { data: f.data, cps: new Set([32]) }));
          for (const ch of run.text) u.cps.add(ch.codePointAt(0)!);
        }
      }
    }
  }
  const fonts = new Map<string, PDFFont>();
  for (const [key, u] of used) {
    const data = hbWasm ? await subsetFont(u.data, u.cps, hbWasm) : u.data;
    fonts.set(key, await doc.embedFont(data, { subset: false, features: { liga: false, kern: false } }));
  }

  const images = new Map<string, PDFImage>();
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

  // PDF/X-4: RGB 이미지가 어떤 RGB인지(sRGB) 밝혀 두어야 인쇄소 장비가 정확히 CMYK로 바꾼다.
  const srgbRef = opts.pdfx && opts.srgbProfile
    ? doc.context.register(doc.context.flateStream(opts.srgbProfile, { N: 3 }))
    : null;

  /** 요소의 회전을 PDF 좌표계 변환으로 건다. 돌려준 함수로 닫는다. */
  const rotated = (out: PDFPage, el: PageElement | undefined) => {
    if (!el?.rotation) return () => {};
    const a = (-el.rotation * Math.PI) / 180;
    const cx = (el.x + el.w / 2) * k;
    const cy = H - (el.y + el.h / 2) * k;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    out.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy));
    return () => out.pushOperators(popGraphicsState());
  };

  for (const pageIndex of src.pages.keys()) {
    const out = doc.addPage([W + pad * 2 * k, H + pad * 2 * k]);
    const o = pad * k;
    const b = bleed * k;
    out.setTrimBox(o, o, W, H);
    out.setBleedBox(o - b, o - b, W + b * 2, H + b * 2);
    if (srgbRef) {
      out.node.Resources()!.set(PDFName.of('ColorSpace'), doc.context.obj({ DefaultRGB: [PDFName.of('ICCBased'), srgbRef] }));
    }

    if (pad > bleed) {
      // 재단선: 네 모서리에서 도련 바깥쪽으로 긋는다
      const markColor = opts.cmyk ? cmyk(0, 0, 0, 1) : rgb(0, 0, 0);
      const g0 = (bleed + MARK_GAP) * k;
      const len = MARK_LEN * k;
      for (const x of [o, o + W]) {
        for (const y of [o, o + H]) {
          const sx = x === o ? -1 : 1;
          const sy = y === o ? -1 : 1;
          out.drawLine({ start: { x: x + sx * g0, y }, end: { x: x + sx * (g0 + len), y }, thickness: 0.25, color: markColor });
          out.drawLine({ start: { x, y: y + sy * g0 }, end: { x, y: y + sy * (g0 + len) }, thickness: 0.25, color: markColor });
        }
      }
    }

    // 이후 내용은 재단 크기 기준 좌표로 그리고, 도련 바깥은 잘라 낸다
    out.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, o, o), rectangle(-b, -b, W + b * 2, H + b * 2), clip(), endPath());
    if (background) out.drawRectangle({ x: -b, y: -b, width: W + b * 2, height: H + b * 2, color: color(background) });

    const drawText = (t: TextDraw) => {
      const done = rotated(out, t.el);
      for (const line of t.lines) {
        for (const run of line.runs) {
          const font = fonts.get((run.b && t.fontBold ? t.fontBold : t.font).key)!;
          const rise = run.sup ? SUP_RISE * t.size * PT_TO_MM : 0;
          out.pushOperators(setCharacterSpacing(run.ls * k));
          out.drawText(run.text, {
            x: (t.x + run.x) * k, y: H - (t.y + line.baseline - rise) * k, size: run.sup ? t.size * SUP_SCALE : t.size, font, color: color(t.color),
            ...(run.i ? { ySkew: degrees(12) } : {}), // 기울임: 글자를 오른쪽으로 12도 눕힌다
          });
          if ((run.u || run.s) && run.w) {
            // 밑줄·취소선: 화면과 같은 위치·굵기의 가는 사각형으로 긋는다
            const sz = t.size * PT_TO_MM;
            for (const dy of [...(run.u ? [0.13 + 0.055] : []), ...(run.s ? [-0.3 + 0.055] : [])]) {
              out.drawRectangle({ x: (t.x + run.x) * k, y: H - (t.y + line.baseline + sz * dy) * k, width: run.w * k, height: sz * 0.055 * k, color: color(t.color) });
            }
          }
        }
      }
      out.pushOperators(setCharacterSpacing(0));
      done();
    };
    const texts = pageTexts[pageIndex];
    // 요소는 쌓인 순서대로 그린다
    const drawEls = async (els: PageElement[]) => {
     for (const el of els) {
      if (el.type === 'text') {
        const t = texts.find((x) => x.el === el);
        if (t) drawText(t);
        continue;
      }
      const done = rotated(out, el);
      if (el.type === 'rect' && el.shape === 'ellipse') {
        out.drawEllipse({ x: (el.x + el.w / 2) * k, y: H - (el.y + el.h / 2) * k, xScale: (el.w / 2) * k, yScale: (el.h / 2) * k, color: color(el.fill), opacity: el.opacity });
      } else if (el.type === 'rect') {
        out.drawRectangle({ x: el.x * k, y: H - (el.y + el.h) * k, width: el.w * k, height: el.h * k, color: color(el.fill), opacity: el.opacity });
      } else {
        const asset = src.assets[el.assetId];
        if (asset) {
          const img = await embedImage(asset);
          const r = imageDrawRect(el, asset);
          out.pushOperators(pushGraphicsState(), rectangle(el.x * k, H - (el.y + el.h) * k, el.w * k, el.h * k), clip(), endPath());
          out.drawImage(img, { x: r.x * k, y: H - (r.y + r.h) * k, width: r.w * k, height: r.h * k, opacity: el.opacity });
          out.pushOperators(popGraphicsState());
        }
      }
      done();
    }
    };
    const masters = new Set(src.pages[pageIndex].hideMaster ? [] : src.masterElements ?? []);
    await drawEls(pageEls[pageIndex].filter((el) => masters.has(el))); // 공통 요소는 맨 아래에
    for (const im of derivedContent(src, pageIndex).images) {
      const asset = src.assets[im.assetId];
      if (!asset) continue;
      const r = im.rect;
      out.drawImage(await embedImage(asset), { x: r.x * k, y: H - (r.y + r.h) * k, width: r.w * k, height: r.h * k });
    }
    for (const t of texts) if (!t.el) drawText(t);
    for (const r of derivedContent(src, pageIndex).rules) {
      out.drawRectangle({ x: r.x * k, y: H - (r.y + r.h) * k, width: r.w * k, height: r.h * k, color: color('#1f1e1c') });
    }
    await drawEls(pageEls[pageIndex].filter((el) => !masters.has(el)));
    out.pushOperators(popGraphicsState());
  }

  if (opts.pdfx && profile) addPdfX(doc, project, base64Bytes(profile.data), profile.name);
  const bytes = await doc.save({ useObjectStreams: !opts.pdfx });
  // PDF/X-4는 PDF 1.6 기반이다. 쓰는 기능은 1.6 범위 안이므로 머리말의 버전 표기만 맞춘다(길이가 같아 위치 정보는 그대로다).
  if (opts.pdfx && bytes[5] === 0x31 && bytes[7] === 0x37) bytes[7] = 0x36;
  return bytes;
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** PDF/X-4가 요구하는 문서 정보를 넣는다: 출력 인텐트(인쇄 조건과 ICC), 버전 표기, XMP 메타데이터, 문서 ID. */
function addPdfX(doc: PDFDocument, project: Project, icc: Uint8Array, name: string) {
  const ctx = doc.context;
  const iccRef = ctx.register(ctx.flateStream(icc, { N: 4 }));
  const intent = ctx.obj({
    Type: 'OutputIntent', S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of('Custom'), OutputCondition: PDFHexString.fromText(name), Info: PDFHexString.fromText(name),
    DestOutputProfile: iccRef,
  });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  const info = (doc as any).getInfoDict();
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const title = xmlEscape(doc.getTitle() ?? '');
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
${project.meta.author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(project.meta.author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
<xmp:CreatorTool>Book Studio</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:MetadataDate>${iso}</xmp:MetadataDate>
<pdf:Producer>Book Studio</pdf:Producer><pdf:Trapped>False</pdf:Trapped>
<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
<xmpMM:DocumentID>uuid:${project.id}</xmpMM:DocumentID><xmpMM:VersionID>1</xmpMM:VersionID><xmpMM:RenditionClass>default</xmpMM:RenditionClass>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(meta));

  const id = PDFHexString.of(Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
}

/** ICC 프로파일 파일이 인쇄용 CMYK 출력 프로파일인지 확인하고 이름을 읽는다. */
export function inspectIcc(data: Uint8Array): { name: string } {
  const tag = (o: number) => String.fromCharCode(...data.subarray(o, o + 4));
  if (data.length < 132 || tag(36) !== 'acsp') throw new Error('ICC 프로파일 파일이 아니에요.');
  if (tag(16) !== 'CMYK') throw new Error('CMYK 프로파일이 아니에요. 인쇄소가 지정한 CMYK 출력 프로파일을 불러와 주세요.');
  if (tag(12) !== 'prtr') throw new Error('출력 장치용(프린터) 프로파일이 아니에요. 인쇄소가 지정한 출력 프로파일을 불러와 주세요.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let name = '';
  for (let i = 0, n = view.getUint32(128); i < n; i++) {
    const at = 132 + i * 12;
    if (tag(at) !== 'desc') continue;
    const off = view.getUint32(at + 4);
    if (tag(off) === 'desc') name = new TextDecoder('latin1').decode(data.subarray(off + 12, off + 12 + view.getUint32(off + 8) - 1));
    else if (tag(off) === 'mluc') name = new TextDecoder('utf-16be').decode(data.subarray(off + view.getUint32(off + 24), off + view.getUint32(off + 24) + view.getUint32(off + 20)));
  }
  return { name: name.trim() || 'CMYK 출력 프로파일' };
}
