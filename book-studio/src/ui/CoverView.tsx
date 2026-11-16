import { useLayoutEffect, useRef } from 'react';
import { PX_PER_MM } from '../engine/units';
import { COVER_TEMPLATES, SAFE, bleedOf, coverAsProject, coverGeom } from '../model/cover';
import type { Project } from '../model/types';
import { createCover, useStore } from '../store/store';
import { PageStage } from './Canvas';

/** 표지 보기: 뒤표지·책등·앞표지를 하나로 이어 편집한다. */
export function CoverView({ project }: { project: Project }) {
  const zoom = useStore((s) => s.zoom);
  const ref = useRef<HTMLDivElement>(null);
  const g = coverGeom(project);
  const bleed = bleedOf(project);
  const has = !!project.cover;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !has) return;
    const z = Math.min((el.clientWidth - 96) / ((g.width + bleed * 2) * PX_PER_MM), (el.clientHeight - 130) / ((g.height + bleed * 2) * PX_PER_MM));
    if (z > 0) useStore.setState({ zoom: Math.max(0.2, Math.min(4, z)) });
  }, [has, project.id]);

  if (!project.cover) {
    return (
      <div className="canvas cover-empty" id="cover-empty">
        <div>
          <h2>표지 만들기</h2>
          <p>디자인을 고르면 책 제목과 저자를 넣어 앞표지·책등·뒤표지를 한 번에 만들어 드려요.<br />책등 너비는 쪽수와 종이에 맞춰 자동으로 계산되고, 만든 뒤 모든 요소를 고칠 수 있어요.</p>
          <div className="cover-templates">
            {COVER_TEMPLATES.map((t) => (
              <button key={t.id} data-cover-template={t.id} onClick={() => createCover(t.id)}>
                <i style={{ background: t.background, color: t.ink }}>{t.band && <em style={{ background: t.band }} />}<span>제목</span></i>
                <b>{t.name}</b><small>{t.hint}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const scale = zoom * PX_PER_MM;
  const leftBound = project.print.binding === 'left';
  const line = 0.75 / scale;
  const dash = `${3 / scale} ${3 / scale}`;
  const zones = [
    ...(g.flap ? [{ x: 0, w: g.flap, name: leftBound ? '뒷날개' : '앞날개' }] : []),
    { x: g.backX, w: g.pageW, name: leftBound ? '뒤표지' : '앞표지' },
    ...(g.spine ? [{ x: g.spineX, w: g.spine, name: g.spine >= 12 ? `책등 ${g.spine}mm` : '' }] : []),
    { x: g.frontX, w: g.pageW, name: leftBound ? '앞표지' : '뒤표지' },
    ...(g.flap ? [{ x: g.frontX + g.pageW, w: g.flap, name: leftBound ? '앞날개' : '뒷날개' }] : []),
  ];
  const overlay = (
    <g pointerEvents="none" id="cover-guides">
      {/* 접히는 선: 책등과 날개 */}
      {[g.spineX, g.frontX, ...(g.flap ? [g.backX, g.frontX + g.pageW] : [])].map((x, i) => (
        <line key={i} x1={x} x2={x} y1={-bleed} y2={g.height + bleed} stroke="#2f6f9f" strokeWidth={line} strokeDasharray={dash} />
      ))}
      {/* 안전 영역: 글자와 로고는 이 안에 */}
      {[g.backX, g.frontX].map((x) => (
        <rect key={x} x={x + SAFE} y={SAFE} width={g.pageW - SAFE * 2} height={g.height - SAFE * 2} fill="none" stroke="#7a8b72" strokeWidth={line} strokeDasharray={dash} />
      ))}
    </g>
  );

  return (
    <div className="canvas" ref={ref} id="canvas" onPointerDown={() => useStore.setState({ selection: [], editingId: null })}>
      <div className="spread cover-spread">
        <div>
          <div className="cover-zones" style={{ marginLeft: bleed * scale, width: g.width * scale }}>
            {zones.map((z) => <span key={z.x} style={{ left: z.x * scale, width: z.w * scale }}>{z.name}</span>)}
          </div>
          <PageStage project={coverAsProject(project)} pageIndex={0} scale={scale} cover bleed={bleed} background={project.cover.background} overlay={overlay} />
          <p className="cover-legend" id="cover-size">
            펼친 크기 {Math.round(g.width * 10) / 10} × {g.height}mm · 책등 {g.spine}mm · <i className="lg trim" /> 재단선 <i className="lg fold" /> 접는 선 <i className="lg safe" /> 안전 영역 · 바깥 옅은 부분은 도련 {bleed}mm
          </p>
        </div>
      </div>
    </div>
  );
}
