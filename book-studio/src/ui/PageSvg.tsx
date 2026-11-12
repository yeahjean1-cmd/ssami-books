import { memo, useSyncExternalStore } from 'react';
import { derivedContent, type PlacedText } from '../engine/flow';
import { fontsVersion, subscribeFonts } from '../engine/fonts';
import { imageDrawRect, resolveText } from '../engine/render';
import { PT_TO_MM } from '../engine/units';
import { contentRect } from '../model/factory';
import type { ImageElement, PageElement, Project, TextElement } from '../model/types';

const TEXT_STYLE = { whiteSpace: 'pre', fontKerning: 'none', fontVariantLigatures: 'none', fontFeatureSettings: '"kern" 0, "liga" 0' } as const;

/** 요소 가운데를 중심으로 한 회전 변환 */
export const rotationOf = (el: PageElement) =>
  el.rotation ? `rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined;

const TextView = memo(function TextView({ el, hidden }: { el: TextElement; hidden?: boolean; fv: number }) {
  const res = resolveText(el);
  if (!res || hidden) return null;
  const { layout, font } = res;
  return (
    <g fontFamily={`'${font.cssFamily}'`} fontWeight={font.bold ? 700 : 400} fontSize={layout.fontSizeMm} fill={el.style.color}
      style={TEXT_STYLE} transform={rotationOf(el)}>
      {layout.lines.map((line, i) =>
        line.runs.map((run, j) => (
          <text key={`${i}-${j}`} x={el.x + run.x} y={el.y + line.baseline} letterSpacing={run.ls || undefined}>{run.text}</text>
        )),
      )}
    </g>
  );
});

/** 자동 조판된 글(본문 흐름·목차·쪽 번호·머리말) */
const PlacedTextView = memo(function PlacedTextView({ t }: { t: PlacedText }) {
  return (
    <g fontFamily={`'${t.font.cssFamily}'`} fontWeight={t.font.bold ? 700 : 400} fontSize={t.fontSize * PT_TO_MM} fill={t.color} style={TEXT_STYLE}>
      {t.lines.map((line, i) =>
        line.runs.map((run, j) => (
          <text key={`${i}-${j}`} x={t.x + run.x} y={t.y + line.baseline} letterSpacing={run.ls || undefined}>{run.text}</text>
        )),
      )}
    </g>
  );
});

function ImageView({ el, project }: { el: ImageElement; project: Project }) {
  const asset = project.assets[el.assetId];
  if (!asset) {
    return <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="#e6e1d8" stroke="#b5483a" strokeWidth={0.3} transform={rotationOf(el)} />;
  }
  const r = imageDrawRect(el, asset);
  const clipId = `clip-${el.id}`;
  return (
    <g opacity={el.opacity} transform={rotationOf(el)}>
      <clipPath id={clipId}>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} />
      </clipPath>
      <image href={asset.dataUrl} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
    </g>
  );
}

/** 폰트가 로드되면 다시 그리도록 구독한다. */
export const useFontsVersion = () => useSyncExternalStore(subscribeFonts, fontsVersion);

interface Props {
  project: Project;
  pageIndex: number;
  /** 화면 px / mm */
  scale: number;
  showGuides?: boolean;
  editingId?: string | null;
  /** 종이색 (표지 배경) */
  background?: string;
  /** 재단선 바깥으로 함께 보여 줄 도련 mm */
  bleed?: number;
  children?: React.ReactNode;
}

/** 한 쪽을 mm 좌표계의 SVG로 그린다. 썸네일·편집 캔버스·표지가 함께 쓴다. */
export function PageSvg({ project, pageIndex, scale, showGuides, editingId, background = '#fffefb', bleed = 0, children }: Props) {
  const fv = useFontsVersion();
  const { width, height } = project.format;
  const page = project.pages[pageIndex];
  const c = contentRect(project, pageIndex);
  const derived = derivedContent(project, pageIndex);
  const b = bleed;
  const line = 0.75 / scale;
  return (
    <svg width={(width + b * 2) * scale} height={(height + b * 2) * scale} viewBox={`${-b} ${-b} ${width + b * 2} ${height + b * 2}`} style={{ display: 'block' }}>
      <rect x={-b} y={-b} width={width + b * 2} height={height + b * 2} fill={background} />
      {derived.images.map((im) => project.assets[im.assetId] && (
        <image key={im.key} href={project.assets[im.assetId].dataUrl} x={im.rect.x} y={im.rect.y} width={im.rect.w} height={im.rect.h} preserveAspectRatio="none" />
      ))}
      {derived.texts.map((t) => <PlacedTextView key={t.key} t={t} />)}
      {page.elements.map((el) =>
        el.type === 'text' ? <TextView key={el.id} el={el} hidden={el.id === editingId} fv={fv} />
          : el.type === 'image' ? <ImageView key={el.id} el={el} project={project} />
            : <rect key={el.id} x={el.x} y={el.y} width={el.w} height={el.h} fill={el.fill} opacity={el.opacity} transform={rotationOf(el)} />,
      )}
      {b > 0 && (
        <g pointerEvents="none">
          {/* 도련 영역을 옅게 덮고 재단선을 표시한다 */}
          <path d={`M${-b} ${-b}H${width + b}V${height + b}H${-b}Z M0 0V${height}H${width}V0Z`} fill="rgba(255,255,255,.45)" fillRule="evenodd" />
          <rect width={width} height={height} fill="none" stroke="#b5483a" strokeWidth={line} />
        </g>
      )}
      {showGuides && c.w < width && (
        <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke="#7a8b72" strokeWidth={line}
          strokeDasharray={`${3 / scale} ${3 / scale}`} pointerEvents="none" />
      )}
      {children}
    </svg>
  );
}
