import { useState } from 'react';
import { COVER_TEMPLATES, backRect, coverAsProject, coverGeom, frontRect } from '../model/cover';
import type { PageElement, Project } from '../model/types';
import { moveElement, patchElements, surfaceOf, useStore } from '../store/store';
import { PageSvg } from './PageSvg';

/** 이름을 적어 저장하는 작은 입력 줄 */
export function NameSave({ placeholder, label, onSave, id }: { placeholder: string; label: string; onSave: (name: string) => void; id?: string }) {
  const [name, setName] = useState('');
  return (
    <div className="row name-save">
      <input id={id} type="text" value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button className="btn small" disabled={!name.trim()} onClick={() => { onSave(name); setName(''); }}>{label}</button>
    </div>
  );
}

const describe = (el: PageElement, project: Project) =>
  el.type === 'text' ? el.text.replace(/\s+/g, ' ').trim().slice(0, 18) || '빈 글 상자'
    : el.type === 'image' ? project.assets[el.assetId]?.name ?? '이미지' : '도형';
const KIND = { text: '글', image: '이미지', rect: '도형' } as const;

/** 레이어: 지금 편집 중인 쪽(또는 표지·공통 요소)의 요소를 위에서 아래 순서로 보여 준다. */
export function Layers({ project }: { project: Project }) {
  const centerView = useStore((s) => s.centerView);
  const currentPage = useStore((s) => s.currentPage);
  const selection = useStore((s) => s.selection);
  if (centerView === 'manuscript') return <p className="hint layers-empty">원고 보기에서는 레이어가 없어요.</p>;
  const sf = surfaceOf(project, centerView, currentPage);
  const list = [...sf.elements].reverse();
  const flag = (el: PageElement, patch: Partial<PageElement>) => patchElements(sf.pageId, { [el.id]: patch });
  return (
    <div className="layers" id="layers">
      {!list.length && <p className="hint layers-empty">이 면에 놓은 요소가 없어요. 위의 ‘글 상자·이미지·도형’으로 추가할 수 있어요.</p>}
      {list.map((el, i) => (
        <div key={el.id} className={`layer${selection.includes(el.id) ? ' on' : ''}${el.hidden ? ' off' : ''}`} data-layer={el.id}
          onClick={() => useStore.setState({ selection: [el.id], editingId: null, selectedBlock: null })}>
          <div className="layer-name"><small>{KIND[el.type]}</small><span>{describe(el, project)}</span></div>
          <div className="layer-tools" onClick={(e) => e.stopPropagation()}>
            <button className={el.hidden ? 'on' : ''} data-act="hide" title="숨기면 화면과 PDF에 나오지 않아요" onClick={() => flag(el, { hidden: !el.hidden || undefined })}>{el.hidden ? '숨김' : '보임'}</button>
            <button className={el.locked ? 'on' : ''} data-act="lock" title="잠그면 옮기거나 지울 수 없어요" onClick={() => flag(el, { locked: !el.locked || undefined })}>{el.locked ? '잠김' : '잠금'}</button>
            <button disabled={i === 0} aria-label="한 단계 위로" onClick={() => moveElement(el.id, 1)}>↑</button>
            <button disabled={i === list.length - 1} aria-label="한 단계 아래로" onClick={() => moveElement(el.id, -1)}>↓</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 표지와 책 두께를 입체로 돌려 보는 미리보기. 디자인 확인용이며 인쇄 규격 검증을 대신하지 않는다. */
export function BookPreview({ project, onClose }: { project: Project; onClose: () => void }) {
  const leftBound = project.print.binding === 'left';
  const [angle, setAngle] = useState(leftBound ? 32 : -32);
  const [drag, setDrag] = useState<{ x: number; a: number } | null>(null);
  const g = coverGeom(project);
  const src = coverAsProject(project);
  const k = Math.min(430 / g.height, 300 / g.pageW);
  const W = g.pageW * k;
  const H = g.height * k;
  const D = Math.max(g.spine, 1.5) * k;
  const bg = project.cover!.background;
  const face = (x: number, w: number, transform: string, left = 0) => (
    <div className="face" style={{ width: w, height: H, left, transform, background: bg }}>
      <div style={{ marginLeft: -x * k }}><PageSvg project={src} pageIndex={0} scale={k} background={bg} /></div>
    </div>
  );
  const side = (leftBound ? 1 : -1) * 90;
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="책 미리보기" id="book-preview">
        <div className="modal-head"><h2>책 미리보기</h2><p className="modal-sub">끌어서 돌려 보세요 · {g.pageW} × {g.height}mm, 책등 {g.spine}mm</p></div>
        <div
          className="stage3d"
          onPointerDown={(e) => { setDrag({ x: e.clientX, a: angle }); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => drag && setAngle(drag.a + (e.clientX - drag.x) * 0.6)}
          onPointerUp={() => setDrag(null)}
        >
          <div className="book3d" id="book3d" data-angle={Math.round(angle)} style={{ width: W, height: H, transform: `rotateX(-8deg) rotateY(${angle}deg)` }}>
            {face(frontRect(project, g).x, W, `translateZ(${D / 2}px)`)}
            {face(backRect(project, g).x, W, `rotateY(180deg) translateZ(${D / 2}px)`)}
            {face(g.spineX - (D / k - g.spine) / 2, D, `rotateY(${-side}deg) translateZ(${W / 2}px)`, (W - D) / 2)}
            <div className="face pages" style={{ width: D, height: H, left: (W - D) / 2, transform: `rotateY(${side}deg) translateZ(${W / 2 - 2}px)` }} />
            <div className="face pages flat" style={{ width: W - 3, height: D, top: (H - D) / 2, transform: `rotateX(90deg) translateZ(${H / 2 - 2}px)` }} />
            <div className="face pages flat" style={{ width: W - 3, height: D, top: (H - D) / 2, transform: `rotateX(-90deg) translateZ(${H / 2 - 2}px)` }} />
          </div>
        </div>
        <div className="modal-foot">
          <p className="hint">디자인을 확인하는 용도예요. 실제 인쇄 규격은 사전 검사와 인쇄소 확인으로 점검해 주세요. 쪽 넘김 효과는 아직 없어요.</p>
          <div className="spacer" />
          <button className="btn" onClick={() => setAngle(leftBound ? 32 : -32)}>앞</button>
          <button className="btn" onClick={() => setAngle(leftBound ? 90 : -90)}>책등</button>
          <button className="btn" onClick={() => setAngle(leftBound ? 212 : -212)}>뒤</button>
          <button className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export { COVER_TEMPLATES };
