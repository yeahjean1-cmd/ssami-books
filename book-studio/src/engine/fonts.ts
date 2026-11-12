// 폰트 레지스트리. 화면 렌더링(FontFace)·조판 측정·PDF 임베딩이 같은 폰트 파일을 사용한다.
import * as fontkitNs from '@pdf-lib/fontkit';

const fontkit: any = (fontkitNs as any).default ?? fontkitNs;

export interface LoadedFont {
  key: string;
  family: string;
  bold: boolean;
  /** 화면 렌더링용 CSS font-family (시스템 폰트와 충돌하지 않도록 접두어 사용) */
  cssFamily: string;
  data: Uint8Array;
  /** em 대비 비율 */
  ascent: number;
  descent: number;
  builtin: boolean;
  /** 글자의 전진폭(em 대비 비율) */
  adv(cp: number): number;
  has(cp: number): boolean;
}

export interface FontFamilyInfo {
  family: string;
  label: string;
  builtin: boolean;
  hasBold: boolean;
}

const BUILTIN = [
  { family: 'Nanum Myeongjo', label: '나눔명조', regular: 'NanumMyeongjo-Regular.ttf', bold: 'NanumMyeongjo-Bold.ttf' },
  { family: 'Pretendard', label: '프리텐다드', regular: 'Pretendard-Regular.ttf', bold: 'Pretendard-Bold.ttf' },
  { family: 'Gowun Batang', label: '고운바탕', regular: 'GowunBatang-Regular.ttf', bold: 'GowunBatang-Bold.ttf' },
  { family: 'Nanum Gothic', label: '나눔고딕', regular: 'NanumGothic-Regular.ttf', bold: 'NanumGothic-Bold.ttf' },
];

const registry = new Map<string, LoadedFont>();
const labels = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();

const keyOf = (family: string, bold: boolean) => `${family}:${bold ? 700 : 400}`;

export function fontsVersion() {
  return version;
}
export function subscribeFonts(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export class FontError extends Error {}

export function registerFontData(
  family: string,
  bold: boolean,
  data: Uint8Array,
  opts: { builtin?: boolean; label?: string } = {},
): LoadedFont {
  let fk: any;
  try {
    fk = fontkit.create(data);
  } catch {
    throw new FontError('폰트 파일을 읽을 수 없어요. TTF 또는 OTF 파일인지 확인해 주세요.');
  }
  const upm = fk.unitsPerEm;
  const cache = new Map<number, number>();
  const font: LoadedFont = {
    key: keyOf(family, bold),
    family,
    bold,
    cssFamily: `BS ${family}`,
    data,
    ascent: fk.ascent / upm,
    descent: -fk.descent / upm,
    builtin: !!opts.builtin,
    adv(cp) {
      let v = cache.get(cp);
      if (v === undefined) {
        v = fk.glyphForCodePoint(cp).advanceWidth / upm;
        cache.set(cp, v as number);
      }
      return v as number;
    },
    has: (cp) => fk.hasGlyphForCodePoint(cp),
  };
  registry.set(font.key, font);
  if (opts.label) labels.set(family, opts.label);
  if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
    const face = new FontFace(font.cssFamily, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, {
      weight: bold ? '700' : '400',
    });
    (document as any).fonts.add(face);
    face.load().then(bump, bump);
  }
  bump();
  return font;
}

function bump() {
  version++;
  listeners.forEach((fn) => fn());
}

/** 사용자 폰트 파일을 분석한다. 임베딩이 금지된 폰트는 거부한다. */
export function inspectFontFile(data: Uint8Array): { family: string; bold: boolean } {
  let fk: any;
  try {
    fk = fontkit.create(data);
  } catch {
    throw new FontError('폰트 파일을 읽을 수 없어요. TTF 또는 OTF 파일인지 확인해 주세요.');
  }
  if (fk.fonts) throw new FontError('폰트 묶음(TTC) 파일은 아직 지원하지 않아요.');
  const os2 = fk['OS/2'];
  if (os2?.fsType?.noEmbedding) {
    throw new FontError('이 폰트는 PDF에 포함(임베딩)하는 것이 금지되어 있어 사용할 수 없어요.');
  }
  const family = fk.familyName || '이름 없는 폰트';
  const bold = (os2?.usWeightClass ?? 400) >= 600;
  return { family, bold };
}

export async function loadBuiltinFonts(): Promise<void> {
  await Promise.all(
    BUILTIN.flatMap((f) =>
      ([['regular', false], ['bold', true]] as const).map(async ([k, bold]) => {
        const res = await fetch(`fonts/${f[k]}`);
        if (!res.ok) throw new Error(`기본 폰트를 불러오지 못했어요: ${f.label}`);
        registerFontData(f.family, bold, new Uint8Array(await res.arrayBuffer()), { builtin: true, label: f.label });
      }),
    ),
  );
}

/** 요청한 폰트를 찾는다. 굵은 서체가 없으면 보통 굵기, 폰트가 없으면 기본 폰트로 대체한다. */
export function resolveFont(family: string, bold: boolean): { font: LoadedFont | undefined; missing: boolean } {
  const exact = registry.get(keyOf(family, bold)) ?? registry.get(keyOf(family, !bold));
  if (exact) return { font: exact, missing: false };
  const fallback = registry.get(keyOf('Nanum Myeongjo', bold)) ?? registry.values().next().value;
  return { font: fallback, missing: true };
}

export function listFamilies(): FontFamilyInfo[] {
  const map = new Map<string, FontFamilyInfo>();
  for (const f of registry.values()) {
    const info = map.get(f.family) ?? { family: f.family, label: labels.get(f.family) ?? f.family, builtin: f.builtin, hasBold: false };
    if (f.bold) info.hasBold = true;
    map.set(f.family, info);
  }
  return [...map.values()].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.label.localeCompare(b.label, 'ko'));
}
