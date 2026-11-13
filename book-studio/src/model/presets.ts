import type { Margins } from './types';

export interface FormatPreset {
  id: string;
  name: string;
  /** 세로형 기준 mm */
  width: number;
  height: number;
  hint: string;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'shinkuk', name: '신국판', width: 152, height: 225, hint: '단행본에 가장 널리 쓰여요' },
  { id: 'kuk', name: '국판', width: 148, height: 210, hint: '에세이·소설·시집' },
  { id: '46', name: '46판', width: 127, height: 188, hint: '작고 가벼운 문고·에세이' },
  { id: 'a5', name: 'A5', width: 148, height: 210, hint: '국판과 같은 크기' },
  { id: 'b5', name: 'B5', width: 182, height: 257, hint: '교재·실용서' },
  { id: '46bae', name: '46배판', width: 188, height: 257, hint: '참고서·잡지' },
  { id: 'a4', name: 'A4', width: 210, height: 297, hint: '보고서·자료집' },
  { id: 'kukbae', name: '국배판', width: 210, height: 297, hint: '잡지·화보' },
];

export const CUSTOM_PRESET_ID = 'custom';

export function presetName(id: string): string {
  return FORMAT_PRESETS.find((p) => p.id === id)?.name ?? '사용자 지정';
}

const round = (v: number) => Math.round(v);

/** 판형 크기에 비례한 추천 여백. 신국판(152mm) 기준 값을 폭에 맞춰 조정한다. */
export function recommendedMargins(width: number, height: number): Margins {
  const s = Math.min(width / 152, height / 225);
  const clamp = (v: number, min: number) => Math.max(min, round(v * s));
  return { top: clamp(20, 12), bottom: clamp(24, 14), inside: clamp(22, 14), outside: clamp(18, 10) };
}
