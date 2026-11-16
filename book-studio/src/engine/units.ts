export const PT_TO_MM = 25.4 / 72;
export const MM_TO_PT = 72 / 25.4;
/** CSS 기준 100% 배율에서 1mm가 차지하는 화면 픽셀 */
export const PX_PER_MM = 96 / 25.4;

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
