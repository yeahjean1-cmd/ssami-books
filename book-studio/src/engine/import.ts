// 원고 가져오기: TXT·DOCX·HWPX·HWP 파일을 원고 문단 목록으로 변환한다. 원본 파일은 읽기만 한다.
import type { StyleName } from '../model/types';

export interface ImportedBlock {
  style: StyleName;
  text: string;
  /** 본문 사이 이미지 (data URL) */
  image?: { dataUrl: string; mime: string; name: string };
}

export interface ImportResult {
  format: string;
  blocks: ImportedBlock[];
  /** 변환하면서 잃은 서식 등 사용자에게 알릴 내용 */
  warnings: string[];
}

export class ImportError extends Error {}

const CHAPTER_RE = /^(제\s*\d+\s*[장부편화]|chapter\s+\d+|part\s+\d+|\d+\s*[장부]\b|프롤로그|에필로그|들어가며|들어가는\s*[말글]|나가며|나오는\s*[말글]|머리말|맺음말|맺는\s*[말글]|서문|후기|작가의\s*말|prologue|epilogue)/i;

/** 서식 정보가 없는 글에서 제목처럼 보이는 줄을 찾는다. */
export function guessStyle(line: string): { style: StyleName; text: string } {
  const t = line.trim();
  if (/^#\s+/.test(t)) return { style: 'chapter', text: t.replace(/^#\s+/, '') };
  if (/^#{2,6}\s+/.test(t)) return { style: 'section', text: t.replace(/^#{2,6}\s+/, '') };
  if (/^>\s?/.test(t)) return { style: 'quote', text: t.replace(/^>\s?/, '') };
  if (t.length <= 40 && CHAPTER_RE.test(t) && !/[.。]$/.test(t)) return { style: 'chapter', text: t };
  return { style: 'body', text: t };
}

function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    // 예전 한글 Windows에서 저장한 파일
    return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'EUC-KR(완성형)' };
  }
}

export function importTxt(bytes: Uint8Array): ImportResult {
  const { text, encoding } = decodeText(bytes);
  const blocks = text.replace(/^﻿/, '').split(/\r\n?|\n/).filter((l) => l.trim()).map(guessStyle);
  const warnings = ['TXT에는 서식 정보가 없어요. ‘제1장’, ‘프롤로그’처럼 제목으로 보이는 줄을 장 제목으로 추정했어요.'];
  if (encoding !== 'UTF-8') warnings.push(`문자 인코딩을 ${encoding}(으)로 읽었어요. 글자가 깨져 보이면 UTF-8로 다시 저장해 주세요.`);
  return { format: 'TXT', blocks, warnings };
}

const clean = (s: string) => s.replace(/[ \t ]+/g, ' ').trim();

export async function importDocx(bytes: Uint8Array): Promise<ImportResult> {
  const mammoth: any = await import('mammoth/mammoth.browser');
  let html: string;
  const warnings: string[] = [];
  try {
    const res = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    html = res.value;
  } catch {
    throw new ImportError('Word 파일을 읽지 못했어요. 암호가 걸려 있거나 손상된 파일일 수 있어요.');
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: ImportedBlock[] = [];
  let lostInline = false;
  let tables = 0;

  // 각주: 본문 끝에 모여 있는 각주 내용을 번호 자리에 [^내용]으로 되돌려 넣는다
  const footnotes = new Map<string, string>();
  doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]').forEach((li) => {
    li.querySelectorAll('a').forEach((a) => a.getAttribute('href')?.includes('-ref-') && a.remove());
    footnotes.set(li.id, clean(li.textContent ?? '').replace(/[\[\]]/g, ''));
  });
  doc.querySelectorAll('ol').forEach((ol) => ol.querySelector('li[id^="footnote-"], li[id^="endnote-"]') && ol.remove());
  doc.querySelectorAll('sup').forEach((sup) => {
    const id = sup.querySelector('a')?.getAttribute('href')?.slice(1);
    if (id && footnotes.has(id)) sup.replaceWith(`[^${footnotes.get(id)}]`);
  });

  const pushText = (el: Element, style: StyleName, prefix = '') => {
    if (el.querySelector('u, s, sup, sub')) lostInline = true;
    // 굵게·기울임은 글 안의 표시로 옮긴다(제목은 스타일 자체가 굵으므로 본문·인용문에서만)
    if (style === 'body' || style === 'quote') {
      el.querySelectorAll('em, i').forEach((n) => n.textContent?.trim() && n.replaceWith(`*${n.textContent}*`));
      el.querySelectorAll('strong, b').forEach((n) => n.textContent?.trim() && n.replaceWith(`**${n.textContent}**`));
    }
    el.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    el.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      const mime = /^data:([^;]+)/.exec(src)?.[1] ?? '';
      if (mime) blocks.push({ style: 'body', text: '', image: { dataUrl: src, mime, name: `이미지 ${blocks.filter((b) => b.image).length + 1}` } });
    });
    const text = (el.textContent ?? '').split('\n').map(clean).filter(Boolean).join('\n');
    if (text) blocks.push({ style, text: prefix + text });
  };
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1') pushText(el, 'chapter');
      else if (/^h[2-6]$/.test(tag)) pushText(el, 'section');
      else if (tag === 'blockquote') Array.from(el.children).forEach((c) => pushText(c, 'quote'));
      else if (tag === 'ul' || tag === 'ol') {
        Array.from(el.children).forEach((li, i) => pushText(li, 'body', tag === 'ol' ? `${i + 1}. ` : '• '));
      } else if (tag === 'table') {
        tables++;
        el.querySelectorAll('tr').forEach((tr) => {
          const row = Array.from(tr.querySelectorAll('td, th')).map((c) => clean(c.textContent ?? '')).join('  |  ');
          if (row.replace(/[| ]/g, '')) blocks.push({ style: 'body', text: row });
        });
      } else if (tag === 'p') pushText(el, 'body');
      else walk(el);
    }
  };
  walk(doc.body);
  if (lostInline) warnings.push('밑줄·취소선·첨자는 가져오지 않았어요. 굵게·기울임과 각주는 그대로 가져와요.');
  if (tables) warnings.push(`표 ${tables}개는 표 모양 없이 줄글로 가져왔어요.`);
  warnings.push('글꼴·글자 크기·여백은 원본 대신 선택한 책 디자인(템플릿)을 따라요. 머리말·꼬리말은 가져오지 않아요.');
  return { format: 'Word(DOCX)', blocks, warnings };
}

function headingFromStyleName(name: string): StyleName | null {
  if (/개요\s*1|제목\s*1|heading\s*1|^제목$|^title$/i.test(name)) return 'chapter';
  if (/개요\s*[2-4]|제목\s*[2-4]|heading\s*[2-4]|부제/i.test(name)) return 'section';
  if (/인용/.test(name)) return 'quote';
  return null;
}

export async function importHwpx(bytes: Uint8Array): Promise<ImportResult> {
  const JSZip = (await import('jszip')).default;
  let zip: any;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportError('HWPX 파일을 열지 못했어요. 손상된 파일일 수 있어요.');
  }
  const sections = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
  if (!sections.length) throw new ImportError('HWPX 파일에서 본문을 찾지 못했어요. 암호가 걸린 문서는 가져올 수 없어요.');
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const local = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS('*', name));

  const styleNames = new Map<string, string>();
  const header = zip.file(/^Contents\/header\.xml$/i)[0];
  if (header) for (const s of local(parse(await header.async('string')), 'style')) styleNames.set(s.getAttribute('id') ?? '', s.getAttribute('name') ?? '');

  const blocks: ImportedBlock[] = [];
  let pics = 0;
  let tables = 0;
  for (const name of sections) {
    const doc = parse(await zip.file(name).async('string'));
    pics += local(doc, 'pic').length;
    tables += local(doc, 'tbl').length;
    for (const p of local(doc, 'p')) {
      // 표·글상자 안의 문단은 그 문단 차례에 따로 처리되므로, 이 문단에 직접 속한 글만 모은다
      const text = clean(local(p, 't').filter((t) => closestP(t) === p).map((t) => t.textContent ?? '').join(''));
      if (!text) continue;
      const byStyle = headingFromStyleName(styleNames.get(p.getAttribute('styleIDRef') ?? '') ?? '');
      blocks.push(byStyle ? { style: byStyle, text } : guessStyle(text));
    }
  }
  const warnings = ['글꼴·글자 크기·여백은 원본 대신 선택한 책 디자인(템플릿)을 따라요. 글자 단위 서식과 각주는 가져오지 않아요.'];
  if (pics) warnings.push(`그림 ${pics}개는 가져오지 않았어요. 편집 화면에서 다시 넣어 주세요.`);
  if (tables) warnings.push(`표 ${tables}개는 표 모양 없이 칸마다 한 문단으로 가져왔어요.`);
  return { format: '한글(HWPX)', blocks, warnings };
}

function closestP(el: Element): Element | null {
  for (let n = el.parentElement; n; n = n.parentElement) if (n.localName === 'p') return n;
  return null;
}

/** HWP 5.0 문단 텍스트 레코드에서 글자만 뽑는다. 제어 문자는 종류에 따라 1글자 또는 8글자를 차지한다. */
export function hwpParaText(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let out = '';
  for (let i = 0; i + 1 < data.byteLength; i += 2) {
    const c = view.getUint16(i, true);
    if (c >= 32) out += String.fromCharCode(c);
    else if (c === 10) out += '\n';
    else if (c === 9) { out += ' '; i += 14; } // 탭(인라인 컨트롤)
    else if (c === 0 || c === 13 || (c >= 24 && c <= 31)) { if (c === 30 || c === 31) out += ' '; else if (c === 24) out += '-'; }
    else i += 14; // 확장·인라인 컨트롤: 8글자 폭
  }
  return out;
}

export async function importHwp(bytes: Uint8Array): Promise<ImportResult> {
  const [CFB, { inflateSync }] = await Promise.all([import('cfb'), import('fflate')]);
  const cfbRead = (CFB as any).read ?? (CFB as any).default.read;
  const cfbFind = (CFB as any).find ?? (CFB as any).default.find;
  let cfb: any;
  try {
    cfb = cfbRead(bytes, { type: 'array' });
  } catch {
    throw new ImportError('HWP 파일을 열지 못했어요. 손상되었거나 아주 오래된(HWP 3.0 이하) 형식일 수 있어요.');
  }
  const headRaw = cfbFind(cfb, '/FileHeader')?.content;
  const head = headRaw ? new Uint8Array(headRaw) : undefined;
  if (!head || !new TextDecoder().decode(head.slice(0, 17)).startsWith('HWP Document File')) {
    throw new ImportError('HWP 5.0 형식의 문서가 아니에요. 한글에서 HWPX나 DOCX로 다시 저장해서 가져와 주세요.');
  }
  const flags = head[36];
  if (flags & 2) throw new ImportError('암호가 걸린 HWP 문서는 가져올 수 없어요. 암호를 해제한 뒤 다시 시도해 주세요.');
  if (flags & 4) throw new ImportError('배포용 HWP 문서는 가져올 수 없어요. 원본 문서를 사용해 주세요.');
  const compressed = (flags & 1) === 1;

  const blocks: ImportedBlock[] = [];
  let controls = 0;
  for (let n = 0; ; n++) {
    const entry = cfbFind(cfb, `/BodyText/Section${n}`);
    if (!entry) break;
    let data = new Uint8Array(entry.content);
    if (compressed) {
      try {
        data = inflateSync(data);
      } catch {
        throw new ImportError('HWP 문서의 본문 압축을 풀지 못했어요. 파일이 손상되었을 수 있어요.');
      }
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let pos = 0; pos + 4 <= data.byteLength; ) {
      const h = view.getUint32(pos, true);
      pos += 4;
      const tag = h & 0x3ff;
      let size = h >>> 20;
      if (size === 0xfff) {
        size = view.getUint32(pos, true);
        pos += 4;
      }
      if (tag === 67) {
        // HWPTAG_PARA_TEXT
        for (const line of hwpParaText(data.subarray(pos, pos + size)).split('\n')) {
          const text = clean(line);
          if (text) blocks.push(guessStyle(text));
        }
      } else if (tag === 71) controls++; // HWPTAG_CTRL_HEADER (표·그림 등)
      pos += size;
    }
  }
  if (!blocks.length) throw new ImportError('HWP 문서에서 글을 찾지 못했어요.');
  const warnings = [
    'HWP는 글 내용만 가져와요. 문단 스타일 정보는 읽지 않고, 제목으로 보이는 줄을 장 제목으로 추정했어요.',
    '글꼴·글자 서식·그림·표 모양·각주는 가져오지 않아요. 더 정확하게 가져오려면 한글에서 DOCX로 저장해서 가져와 주세요.',
  ];
  if (controls) warnings.push('표·그림·글상자 안의 글은 본문 사이에 줄글로 들어갔을 수 있어요. 가져온 뒤 원고를 확인해 주세요.');
  return { format: '한글(HWP)', blocks, warnings };
}

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'footnote',
  'object', 'themedata', 'datastore', 'generator', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'latentstyles', 'pgdsctbl', 'fldinst']);
const RTF_CHARS: Record<string, string> = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', tab: ' ', cell: ' ' };

/** RTF에서 글만 뽑는다. 한글은 유니코드(\\uN) 또는 완성형 바이트(\\'hh)로 들어 있다. */
export function importRtf(bytes: Uint8Array): ImportResult {
  const src = new TextDecoder('latin1').decode(bytes);
  if (!src.startsWith('{\\rtf')) throw new ImportError('RTF 파일이 아니에요.');
  let out = '';
  const pending: number[] = [];
  const flush = () => {
    if (pending.length) out += new TextDecoder('euc-kr').decode(new Uint8Array(pending));
    pending.length = 0;
  };
  let depth = 0;
  let skipDepth = -1; // 이 깊이의 묶음이 끝날 때까지 건너뛴다(글꼴표·그림 등)
  let uc = 1;
  let skipChars = 0; // \\uN 뒤에 오는 대체 글자
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth === skipDepth) skipDepth = -1;
      depth--;
    } else if (c === '\\') {
      const n = src[i + 1];
      if (n === '\\' || n === '{' || n === '}') {
        if (skipDepth < 0) { flush(); out += n; }
        i++;
      } else if (n === "'") {
        const b = parseInt(src.slice(i + 2, i + 4), 16);
        i += 3;
        if (skipChars > 0) skipChars--;
        else if (skipDepth < 0 && !Number.isNaN(b)) pending.push(b);
      } else if (n === '*') {
        if (skipDepth < 0) skipDepth = depth;
        i++;
      } else {
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (skipDepth >= 0) continue;
        const [, word, num] = m;
        if (RTF_SKIP.has(word)) skipDepth = depth;
        else if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') { flush(); out += '\n'; }
        else if (word === 'u' && num) { flush(); out += String.fromCharCode((parseInt(num) + 65536) % 65536); skipChars = uc; }
        else if (word === 'uc' && num) uc = parseInt(num);
        else if (RTF_CHARS[word]) { flush(); out += RTF_CHARS[word]; }
      }
    } else if (c !== '\r' && c !== '\n' && skipDepth < 0) {
      if (skipChars > 0) skipChars--;
      else { flush(); out += c; }
    }
  }
  flush();
  const blocks = out.split('\n').map(clean).filter(Boolean).map(guessStyle);
  return { format: 'RTF', blocks, warnings: ['RTF는 글 내용만 가져와요. 글자 서식·그림·표 모양·각주는 가져오지 않고, 제목으로 보이는 줄을 장 제목으로 추정했어요.'] };
}

export const IMPORT_ACCEPT = '.txt,.docx,.hwpx,.hwp,.rtf';

export async function importManuscript(name: string, bytes: Uint8Array): Promise<ImportResult> {
  const ext = name.toLowerCase().split('.').pop();
  let result: ImportResult;
  if (ext === 'txt') result = importTxt(bytes);
  else if (ext === 'docx') result = await importDocx(bytes);
  else if (ext === 'hwpx') result = await importHwpx(bytes);
  else if (ext === 'hwp') result = await importHwp(bytes);
  else if (ext === 'rtf') result = importRtf(bytes);
  else if (ext === 'doc') {
    throw new ImportError('예전 Word 형식(DOC)은 지원하지 않아요. Word에서 DOCX로 다시 저장해서 가져와 주세요.');
  } else throw new ImportError('지원하지 않는 파일 형식이에요. TXT, DOCX, HWPX, HWP, RTF 파일을 가져올 수 있어요.');
  if (!result.blocks.length) throw new ImportError('파일에서 글을 찾지 못했어요.');
  return result;
}
