import { useState } from 'react';
import { FontError, inspectFontFile, listFamilies, registerFontData } from '../engine/fonts';
import { inspectIcc } from '../engine/pdf';
import { effectiveDpi, resolveText } from '../engine/render';
import { COVER_TEMPLATES, PAPERS, bleedOf, computedSpine, coverGeom } from '../model/cover';
import { round1 } from '../engine/units';
import { presetName } from '../model/presets';
import { STYLE_LABEL, STYLE_NAMES, TEMPLATES } from '../model/templates';
import type { BindingType, Block, ImageElement, RectElement, Master, PageElement, ParaStyle, Project, RunningText, StyleName, TextElement, TextStyle } from '../model/types';
import { saveFont } from '../store/storage';
import {
  setExpert, applyShopProfile, applyTemplate, applyUserTemplate, deleteShopProfile, deleteUserTemplate, saveShopProfile, saveUserTemplate, shopProfiles, userTemplates,
  createCover, mutate, notify, patchCover, patchPrint, surfaceOf, openManuscript, patchBlock, patchElements, patchMaster, patchPage, patchStyle, patchToc,
  reorderSelection, useStore,
} from '../store/store';
import { NumField, Segmented, pickFile, readFile } from './fields';
import { NameSave } from './Extras';
import { Versions } from './Support';
import { useFontsVersion } from './PageSvg';

async function addUserFont(): Promise<string | null> {
  const file = await pickFile('.ttf,.otf');
  if (!file) return null;
  try {
    const data = new Uint8Array(await readFile(file, 'buffer'));
    const { family, bold } = inspectFontFile(data);
    registerFontData(family, bold, data);
    await saveFont({ key: `${family}:${bold}`, family, bold, data });
    notify(`‘${family}’ ${bold ? '굵은 ' : ''}서체를 추가했어요. 폰트의 사용 범위(라이선스)는 직접 확인해 주세요.`);
    return family;
  } catch (e) {
    notify(e instanceof FontError ? e.message : '폰트를 추가하지 못했어요.', 'error');
    return null;
  }
}

function Geometry({ el, pageId }: { el: PageElement; pageId: string }) {
  const set = (patch: Partial<PageElement>, key: string) => patchElements(pageId, { [el.id]: patch }, { coalesce: `${key}:${el.id}` });
  return (
    <section>
      <h3>위치와 크기</h3>
      <div className="grid2">
        <NumField label="가로 위치" unit="mm" value={round1(el.x)} step={0.5} onChange={(x) => set({ x }, 'x')} />
        <NumField label="세로 위치" unit="mm" value={round1(el.y)} step={0.5} onChange={(y) => set({ y }, 'y')} />
        <NumField label="너비" unit="mm" value={round1(el.w)} min={3} step={0.5} onChange={(w) => set({ w }, 'w')} />
        <NumField label="높이" unit="mm" value={round1(el.h)} min={3} step={0.5} onChange={(h) => set({ h }, 'h')} />
      </div>
      <NumField id="rotation" label="회전" unit="°" value={el.rotation ?? 0} min={-360} max={360} step={1} onChange={(v) => set({ rotation: ((v % 360) + 360) % 360 || undefined }, 'rot')} />
      {!!el.rotation && <p className="hint">돌린 요소는 끌어서 옮길 수 있고, 크기는 위 숫자로 바꿔요.</p>}
      <div className="row">
        <button className="btn" onClick={() => reorderSelection('front')}>맨 앞으로</button>
        <button className="btn" onClick={() => reorderSelection('back')}>맨 뒤로</button>
      </div>
    </section>
  );
}

/** 글자·문단 속성 편집. 글 상자와 문단 스타일이 함께 쓴다. */
function StyleControls({ s, set, flow }: { s: TextStyle; set: (patch: Partial<TextStyle>, key: string) => void; flow?: boolean }) {
  useFontsVersion();
  const families = listFamilies();
  const current = families.find((f) => f.family === s.fontFamily);
  return (
    <>
      <section>
        <h3>글자</h3>
        <label className="field">
          <span>서체</span>
          <select
            id="font-family"
            value={current ? s.fontFamily : '__missing'}
            onChange={async (e) => {
              if (e.target.value === '__add') {
                const family = await addUserFont();
                if (family) set({ fontFamily: family }, 'font');
              } else set({ fontFamily: e.target.value }, 'font');
            }}
          >
            {!current && <option value="__missing">{s.fontFamily} (없음)</option>}
            {families.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
            <option value="__add">내 폰트 파일 추가…</option>
          </select>
        </label>
        <div className="grid2">
          <NumField id="font-size" label="크기" unit="pt" value={s.fontSize} min={4} max={300} step={0.5} onChange={(fontSize) => set({ fontSize }, 'size')} />
          <Segmented label="굵기" value={s.bold ? 'b' : 'r'} onChange={(v) => set({ bold: v === 'b' }, 'bold')}
            options={[{ value: 'r', label: '보통' }, { value: 'b', label: '굵게' }]} />
          <NumField label="행간" unit="배" value={s.lineHeight} min={0.8} max={4} step={0.05} onChange={(lineHeight) => set({ lineHeight }, 'lh')} />
          <div className="adv"><NumField label="자간" unit="‰" value={s.letterSpacing} min={-200} max={1000} step={5} onChange={(letterSpacing) => set({ letterSpacing }, 'ls')} /></div>
        </div>
        {s.bold && current && !current.hasBold && (
          <p className="hint">이 서체는 굵은 글꼴 파일이 없어 보통 굵기로 표시돼요.</p>
        )}
        <label className="field">
          <span>색상</span>
          <div className="field-input color">
            <input type="color" value={s.color} onChange={(e) => set({ color: e.target.value }, 'color')} />
            <em>{s.color.toUpperCase()}</em>
          </div>
        </label>
      </section>
      <section>
        <h3>문단</h3>
        <Segmented label="정렬" value={s.align} onChange={(align) => set({ align }, 'align')}
          options={[{ value: 'left', label: '왼쪽' }, { value: 'center', label: '가운데' }, { value: 'right', label: '오른쪽' }, { value: 'justify', label: '양쪽' }]} />
        <div className="grid2">
          <NumField label="첫 줄 들여쓰기" unit="mm" value={s.indent} min={0} max={50} step={0.5} onChange={(indent) => set({ indent }, 'indent')} />
          {!flow && <NumField label="문단 간격" unit="mm" value={s.paraSpacing} min={0} max={50} step={0.5} onChange={(paraSpacing) => set({ paraSpacing }, 'ps')} />}
        </div>
        <div className="adv"><Segmented label="줄바꿈" value={s.wordBreak} onChange={(wordBreak) => set({ wordBreak }, 'wb')}
          options={[{ value: 'char', label: '글자 단위' }, { value: 'word', label: '낱말 단위' }]} /></div>
        {!flow && <p className="hint">책 본문은 보통 ‘글자 단위’와 ‘양쪽’ 정렬을 써요. 문장부호가 줄 처음에 오지 않도록 자동으로 처리돼요.</p>}
      </section>
    </>
  );
}

function TextProps({ el, pageId }: { el: TextElement; pageId: string }) {
  useFontsVersion();
  const s = el.style;
  const set = (patch: Partial<TextStyle>, key: string) =>
    patchElements(pageId, { [el.id]: { style: { ...s, ...patch } } }, { coalesce: `${key}:${el.id}` });
  const res = resolveText(el);
  return (
    <>
      {res?.layout.overflow && (
        <div className="notice warn" id="overflow-notice">
          글이 상자보다 길어서 일부가 보이지 않아요.
          <button className="btn small" onClick={() => patchElements(pageId, { [el.id]: { h: Math.ceil(res.layout.fullHeight * 10) / 10 } })}>
            상자를 글 길이에 맞추기
          </button>
        </div>
      )}
      {res?.missingFont && (
        <div className="notice warn">‘{s.fontFamily}’ 폰트가 이 기기에 없어 기본 서체로 표시하고 있어요.</div>
      )}
      <StyleControls s={s} set={set} />
      <Geometry el={el} pageId={pageId} />
    </>
  );
}

/** 본문 흐름에서 고른 문단: 문단 종류를 바꾸거나, 그 종류의 스타일을 책 전체에 걸쳐 고친다. */
function BlockProps({ block, project }: { block: Block; project: Project }) {
  const style = project.styles![block.style];
  const set = (patch: Partial<ParaStyle>, key: string) => patchStyle(block.style, patch, key);
  const count = project.story!.filter((b) => b.style === block.style && !b.assetId).length;
  const inManuscript = useStore((s) => s.centerView === 'manuscript');
  return (
    <>
      <section>
        <h3>선택한 문단</h3>
        <label className="field">
          <span>문단 종류</span>
          <select id="block-style" value={block.style} onChange={(e) => patchBlock(block.id, { style: e.target.value as StyleName })}>
            {STYLE_NAMES.map((n) => <option key={n} value={n}>{STYLE_LABEL[n]}</option>)}
          </select>
        </label>
        <label className="check">
          <input id="block-break" type="checkbox" checked={!!block.breakBefore} onChange={(e) => patchBlock(block.id, { breakBefore: e.target.checked })} />
          이 문단부터 새 쪽에서 시작
        </label>
        {!inManuscript && <button className="btn" id="edit-in-manuscript" onClick={() => openManuscript(block.id)}>원고에서 글 고치기</button>}
      </section>
      <div className="notice info" id="style-scope">
        아래는 ‘{STYLE_LABEL[block.style]}’ 스타일이에요. 고치면 책 전체의 {STYLE_LABEL[block.style]} {count}개 문단에 함께 적용돼요.
      </div>
      <StyleControls s={style} set={set} flow />
      <section className="adv">
        <h3>간격과 쪽 나눔</h3>
        <div className="grid2">
          <NumField label="문단 앞" unit="mm" value={style.spaceBefore} min={0} max={150} step={0.5} onChange={(spaceBefore) => set({ spaceBefore }, 'sb')} />
          <NumField label="문단 뒤" unit="mm" value={style.spaceAfter} min={0} max={150} step={0.5} onChange={(spaceAfter) => set({ spaceAfter }, 'sa')} />
          <NumField label="좌우 들여 넣기" unit="mm" value={style.inset} min={0} max={40} step={0.5} onChange={(inset) => set({ inset }, 'inset')} />
        </div>
        <label className="check">
          <input type="checkbox" checked={style.breakBefore} onChange={(e) => set({ breakBefore: e.target.checked }, 'bb')} />
          항상 새 쪽에서 시작
        </label>
      </section>
    </>
  );
}

const RUNNING: { value: RunningText; label: string }[] = [
  { value: 'none', label: '없음' }, { value: 'title', label: '책 제목' }, { value: 'chapter', label: '장 제목' }, { value: 'author', label: '저자' },
];

/** 책 디자인: 템플릿, 쪽 번호와 머리말(공통 요소), 차례 */
function BookDesign({ project }: { project: Project }) {
  const m = project.master!;
  const currentPage = useStore((s) => s.currentPage);
  const page = project.pages[currentPage];
  const pn = (patch: Partial<Master['pageNumber']>, key: string) => patchMaster((x) => ({ ...x, pageNumber: { ...x.pageNumber, ...patch } }), key);
  const hd = (patch: Partial<Master['header']>, key: string) => patchMaster((x) => ({ ...x, header: { ...x.header, ...patch } }), key);
  const hasToc = project.pages.some((p) => p.kind === 'toc');
  useStore((s) => s.libraryVersion);
  const mine = userTemplates();
  return (
    <>
      <section>
        <h3>본문 디자인 템플릿</h3>
        <div className="template-list">
          {TEMPLATES.map((t) => (
            <button key={t.id} data-template={t.id} className={`template${project.templateId === t.id ? ' on' : ''}`}
              onClick={() => {
                if (project.templateId === t.id || confirm(`‘${t.name}’ 템플릿을 적용할까요? 지금까지 고친 문단 스타일과 쪽 번호 설정이 템플릿 값으로 바뀌어요. (실행 취소로 되돌릴 수 있어요)`)) applyTemplate(t.id);
              }}>
              <b>{t.name}</b><small>{t.hint}</small>
            </button>
          ))}
        </div>
        <p className="hint">템플릿은 시작점이에요. 본문에서 문단을 누르면 글꼴·크기·간격을 자유롭게 고칠 수 있어요.</p>
        {mine.length > 0 && (
          <div className="saved-list" id="my-templates">
            {mine.map((t) => (
              <div key={t.id} className={project.templateId === t.id ? 'on' : ''}>
                <span>{t.name}</span>
                <button className="btn small" onClick={() => applyUserTemplate(t.id)}>적용</button>
                <button className="btn small ghost" aria-label={`${t.name} 삭제`} onClick={() => deleteUserTemplate(t.id)}>삭제</button>
              </div>
            ))}
          </div>
        )}
        <NameSave id="tpl-name" placeholder="지금 디자인의 이름" label="내 템플릿으로 저장" onSave={saveUserTemplate} />
        <label className="check adv">
          <input id="baseline-grid" type="checkbox" checked={!!project.baselineGrid} onChange={(e) => mutate((p) => ({ ...p, baselineGrid: e.target.checked }))} />
          본문 줄을 기준선 격자에 맞추기
        </label>
        <p className="hint adv">격자를 켜면 제목이나 인용문 뒤에도 본문 줄이 같은 높이에 놓여, 펼친 양쪽의 줄이 나란해져요.</p>
        <label className="check adv">
          <input id="notes-book" type="checkbox" checked={project.footnoteNumbering === 'book'} onChange={(e) => mutate((p) => ({ ...p, footnoteNumbering: e.target.checked ? 'book' : undefined }))} />
          각주 번호를 책 전체에 이어서 매기기
        </label>
      </section>
      <section>
        <h3>쪽 번호</h3>
        <label className="check">
          <input id="pn-show" type="checkbox" checked={m.pageNumber.show} onChange={(e) => pn({ show: e.target.checked }, 'show')} />
          쪽 번호 넣기
        </label>
        {m.pageNumber.show && (
          <>
            <Segmented label="위치" value={m.pageNumber.position} onChange={(position) => pn({ position }, 'pos')}
              options={[{ value: 'bottom-center', label: '아래 가운데' }, { value: 'bottom-outside', label: '아래 바깥쪽' }]} />
            <Segmented label="숫자" value={m.pageNumber.format} onChange={(format) => pn({ format }, 'fmt')}
              options={[{ value: 'arabic', label: '1, 2, 3' }, { value: 'roman', label: 'i, ii, iii' }]} />
            <div className="grid2">
              <NumField id="pn-first" label="번호를 시작할 쪽" unit="쪽" value={m.pageNumber.firstPage} min={1} max={project.pages.length} onChange={(v) => pn({ firstPage: Math.round(v) }, 'first')} />
              <NumField label="시작 번호" value={m.pageNumber.startAt} min={1} max={9999} onChange={(v) => pn({ startAt: Math.round(v) }, 'start')} />
            </div>
            <label className="check adv">
              <input id="pn-restart" type="checkbox" checked={!!m.pageNumber.restartPerChapter} onChange={(e) => pn({ restartPerChapter: e.target.checked }, 'restart')} />
              장마다 번호 다시 시작
            </label>
          </>
        )}
      </section>
      <section>
        <h3>머리말</h3>
        <label className="check">
          <input id="hd-show" type="checkbox" checked={m.header.show} onChange={(e) => hd({ show: e.target.checked }, 'show')} />
          본문 쪽 위에 머리말 넣기
        </label>
        {m.header.show && (
          <div className="grid2">
            <label className="field"><span>왼쪽 쪽</span>
              <select value={m.header.left} onChange={(e) => hd({ left: e.target.value as RunningText }, 'l')}>{RUNNING.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </label>
            <label className="field"><span>오른쪽 쪽</span>
              <select value={m.header.right} onChange={(e) => hd({ right: e.target.value as RunningText }, 'r')}>{RUNNING.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </label>
          </div>
        )}
        <NumField label="쪽 번호·머리말 글자 크기" unit="pt" value={m.fontSize} min={5} max={14} step={0.5} onChange={(fontSize) => patchMaster((x) => ({ ...x, fontSize }), 'size')} />
        <label className="check">
          <input id="hide-master" type="checkbox" checked={!!page.hideMaster} onChange={(e) => patchPage(currentPage, { hideMaster: e.target.checked })} />
          지금 보는 {currentPage + 1}쪽에서는 숨기기
        </label>
        <p className="hint">쪽 번호와 머리말은 모든 쪽에 공통으로 들어가요. 장이 시작하는 쪽에는 머리말이 자동으로 빠져요.</p>
      </section>
      {hasToc && (
        <section>
          <h3>차례</h3>
          <label className="field"><span>제목</span>
            <input type="text" value={project.toc?.title ?? ''} onChange={(e) => patchToc({ title: e.target.value }, 'title')} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label className="check"><input type="checkbox" checked={project.toc?.includeSections ?? true} onChange={(e) => patchToc({ includeSections: e.target.checked }, 'sec')} />절 제목도 넣기</label>
          <label className="check"><input type="checkbox" checked={project.toc?.leader ?? true} onChange={(e) => patchToc({ leader: e.target.checked }, 'leader')} />점선으로 쪽 번호 잇기</label>
          <p className="hint">차례는 원고의 장·절 제목에서 자동으로 만들어지고, 쪽이 바뀌면 번호도 따라 바뀌어요.</p>
        </section>
      )}
    </>
  );
}

function ImageProps({ el, pageId, project }: { el: ImageElement; pageId: string; project: Project }) {
  const asset = project.assets[el.assetId];
  const dpi = asset ? Math.round(effectiveDpi(el, asset)) : 0;
  return (
    <>
      {asset && dpi < 200 && (
        <div className="notice warn">
          인쇄하면 흐리게 보일 수 있어요(현재 {dpi}dpi). 이미지를 더 작게 넣거나 더 큰 원본을 사용해 주세요. 인쇄에는 300dpi 이상을 권장해요.
        </div>
      )}
      <section>
        <h3>이미지</h3>
        {asset && (
          <dl className="info">
            <dt>파일</dt><dd title={asset.name}>{asset.name}</dd>
            <dt>원본 크기</dt><dd>{asset.pxW} × {asset.pxH}px</dd>
            <dt>인쇄 해상도</dt><dd id="image-dpi">{dpi}dpi</dd>
          </dl>
        )}
        <Segmented label="프레임에 넣는 방식" value={el.fit} onChange={(fit) => patchElements(pageId, { [el.id]: { fit } })}
          options={[{ value: 'cover', label: '채우기' }, { value: 'contain', label: '맞추기' }, { value: 'stretch', label: '늘이기' }]} />
        <NumField label="불투명도" unit="%" value={Math.round(el.opacity * 100)} min={0} max={100} step={5}
          onChange={(v) => patchElements(pageId, { [el.id]: { opacity: v / 100 } }, { coalesce: `op:${el.id}` })} />
      </section>
      <Geometry el={el} pageId={pageId} />
    </>
  );
}

function RectProps({ el, pageId }: { el: RectElement; pageId: string }) {
  return (
    <>
      <section>
        <h3>도형</h3>
        <Segmented label="모양" value={el.shape ?? 'rect'} onChange={(v) => patchElements(pageId, { [el.id]: { shape: v === 'ellipse' ? 'ellipse' : undefined } })}
          options={[{ value: 'rect', label: '사각형' }, { value: 'ellipse', label: '원' }]} />
        <button className="btn small" id="make-line" onClick={() => patchElements(pageId, { [el.id]: { shape: undefined, h: 0.3 } })}>가는 선으로 만들기 (0.3mm)</button>
        <label className="field">
          <span>채우기 색</span>
          <div className="field-input color">
            <input id="rect-fill" type="color" value={el.fill} onChange={(e) => patchElements(pageId, { [el.id]: { fill: e.target.value } }, { coalesce: `fill:${el.id}` })} />
            <em>{el.fill.toUpperCase()}</em>
          </div>
        </label>
        <NumField label="불투명도" unit="%" value={Math.round(el.opacity * 100)} min={0} max={100} step={5}
          onChange={(v) => patchElements(pageId, { [el.id]: { opacity: v / 100 } }, { coalesce: `op:${el.id}` })} />
      </section>
      <Geometry el={el} pageId={pageId} />
    </>
  );
}

async function loadProfile() {
  const file = await pickFile('.icc,.icm');
  if (!file) return;
  try {
    const data = new Uint8Array(await readFile(file, 'buffer'));
    const { name } = inspectIcc(data);
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    patchPrint({ profile: { name, data: btoa(bin) } }, 'profile');
    notify(`출력 프로파일 ‘${name}’을(를) 불러왔어요. 이제 PDF/X-4로 내보낼 수 있어요.`);
  } catch (e) {
    notify(e instanceof Error ? e.message : '프로파일을 읽지 못했어요.', 'error');
  }
}

/** 인쇄 설정: 도련, 제본, 인쇄소 출력 프로파일 */
function PrintSettings({ project }: { project: Project }) {
  const profile = project.print.profile;
  useStore((s) => s.libraryVersion);
  const shops = shopProfiles();
  return (
    <section>
      <h3>인쇄 설정</h3>
      <div className="grid2">
        <NumField id="bleed" label="도련" unit="mm" value={bleedOf(project)} min={0} max={10} step={0.5} onChange={(bleed) => patchPrint({ bleed }, 'bleed')} />
        <label className="field"><span>제본</span>
          <select id="binding-type" value={project.print.bindingType ?? 'perfect'} onChange={(e) => patchPrint({ bindingType: e.target.value as BindingType }, 'bt')}>
            <option value="perfect">무선제본</option>
            <option value="saddle">중철제본</option>
          </select>
        </label>
      </div>
      <p className="hint">도련은 재단 오차에 대비해 완성 크기 바깥으로 더 인쇄하는 여분이에요. 보통 3mm를 써요. 중철제본은 책등이 없고 쪽수가 4의 배수여야 해요.</p>
      <div className="field">
        <span>인쇄소 출력 프로파일 (ICC)</span>
        <div className="profile" id="profile-name">{profile ? profile.name : '없음'}</div>
        <div className="row">
          <button className="btn small" id="load-profile" onClick={loadProfile}>프로파일 파일 불러오기</button>
          {profile && <button className="btn small" onClick={() => patchPrint({ profile: undefined }, 'profile')}>지우기</button>}
        </div>
      </div>
      <p className="hint">인쇄소가 알려 준 CMYK 프로파일(예: Japan Color 2001 Coated, FOGRA39)을 불러오면 PDF/X-4로 내보낼 수 있어요. 프로젝트에 함께 저장돼요.</p>
      <div className="field adv">
        <span>인쇄소별 설정 (도련·제본·프로파일·종이)</span>
        {shops.length > 0 && (
          <div className="saved-list" id="shop-profiles">
            {shops.map((sp) => (
              <div key={sp.id}>
                <span>{sp.name}</span>
                <button className="btn small" onClick={() => applyShopProfile(sp.id)}>적용</button>
                <button className="btn small ghost" aria-label={`${sp.name} 삭제`} onClick={() => deleteShopProfile(sp.id)}>삭제</button>
              </div>
            ))}
          </div>
        )}
        <NameSave id="shop-name" placeholder="인쇄소 이름" label="지금 설정 저장" onSave={saveShopProfile} />
      </div>
    </section>
  );
}

/** 표지 설정: 디자인, 배경, 종이와 책등, 날개 */
function CoverProps({ project }: { project: Project }) {
  const c = project.cover!;
  const g = coverGeom(project);
  const calc = computedSpine(project);
  const saddle = project.print.bindingType === 'saddle';
  return (
    <>
      <section>
        <h3>표지 디자인</h3>
        <div className="template-list">
          {COVER_TEMPLATES.map((t) => (
            <button key={t.id} className="template" data-cover-template={t.id}
              onClick={() => confirm(`‘${t.name}’ 디자인으로 표지를 다시 만들까요? 지금 표지에 놓은 요소는 사라져요. (실행 취소로 되돌릴 수 있어요)`) && createCover(t.id)}>
              <b>{t.name}</b><small>{t.hint}</small>
            </button>
          ))}
        </div>
        <label className="field">
          <span>배경색</span>
          <div className="field-input color">
            <input id="cover-bg" type="color" value={c.background} onChange={(e) => patchCover({ background: e.target.value }, 'bg')} />
            <em>{c.background.toUpperCase()}</em>
          </div>
        </label>
      </section>
      <section>
        <h3>책등</h3>
        {saddle ? <p className="hint">중철제본은 책등이 없어요.</p> : (
          <>
            <label className="field"><span>내지 종이</span>
              <select id="paper" value={c.paperId} onChange={(e) => {
                const p = PAPERS.find((x) => x.id === e.target.value)!;
                patchCover(p.id === 'custom' ? { paperId: p.id } : { paperId: p.id, paperThickness: p.thickness }, 'paper');
              }}>
                {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id !== 'custom' ? ` · ${p.thickness}mm` : ''}</option>)}
              </select>
            </label>
            <NumField label="종이 한 장 두께" unit="mm" value={c.paperThickness} min={0.03} max={0.5} step={0.005}
              onChange={(paperThickness) => patchCover({ paperThickness, paperId: 'custom' }, 'th')} />
            <dl className="info">
              <dt>계산값</dt><dd id="spine-calc">{calc}mm ({project.pages.length}쪽 ÷ {project.print.duplex ? 2 : 1} × {c.paperThickness}mm)</dd>
              <dt>적용 중</dt><dd id="spine-used">{g.spine}mm{c.spineOverride !== undefined ? ' (직접 입력)' : ''}</dd>
            </dl>
            <label className="check">
              <input id="spine-manual" type="checkbox" checked={c.spineOverride !== undefined} onChange={(e) => patchCover({ spineOverride: e.target.checked ? calc : undefined }, 'so')} />
              인쇄소가 알려 준 책등 너비 직접 입력
            </label>
            {c.spineOverride !== undefined && (
              <NumField id="spine-override" label="책등 너비" unit="mm" value={c.spineOverride} min={0} max={100} step={0.5} onChange={(spineOverride) => patchCover({ spineOverride }, 'sov')} />
            )}
            <p className="hint">종이 두께는 제조사와 생산 시기에 따라 달라 계산값은 참고용이에요. 인쇄 전에 인쇄소가 알려 주는 책등 너비를 꼭 확인해 주세요. 쪽수가 바뀌면 책등과 표지 크기가 자동으로 바뀌어요.</p>
          </>
        )}
      </section>
      <section>
        <h3>날개</h3>
        <NumField id="flap" label="날개 너비 (0 = 없음)" unit="mm" value={c.flap} min={0} max={project.format.width - 10} step={5} onChange={(flap) => patchCover({ flap }, 'flap')} />
      </section>
      <PrintSettings project={project} />
    </>
  );
}

function DocumentProps({ project }: { project: Project }) {
  const showGuides = useStore((s) => s.showGuides);
  const m = project.margins;
  const { width, height } = project.format;
  const setMargin = (key: keyof typeof m, v: number) =>
    mutate((p) => ({ ...p, margins: { ...p.margins, [key]: v } }), { coalesce: `margin:${key}` });
  const setMeta = (key: keyof Project['meta'], v: string) =>
    mutate((p) => ({ ...p, meta: { ...p.meta, [key]: v } }), { coalesce: `meta:${key}` });
  return (
    <>
      <section>
        <h3>책 정보</h3>
        {([['title', '제목'], ['subtitle', '부제'], ['author', '저자'], ['publisher', '출판사']] as const).map(([k, label]) => (
          <label className="field" key={k}>
            <span>{label}</span>
            <input type="text" value={project.meta[k]} onChange={(e) => setMeta(k, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        ))}
        <p className="hint">책 정보는 PDF 문서 정보에 기록돼요. 이미 쪽에 넣은 글은 바뀌지 않아요.</p>
      </section>
      <section>
        <h3>판형</h3>
        <dl className="info">
          <dt>크기</dt><dd>{presetName(project.format.presetId)} · {width} × {height}mm</dd>
          <dt>인쇄</dt><dd>{project.print.duplex ? '양면' : '단면'} · {project.print.binding === 'left' ? '좌철' : '우철'}</dd>
        </dl>
      </section>
      <section>
        <h3>여백</h3>
        <div className="grid2">
          <NumField id="margin-top" label="위" unit="mm" value={m.top} min={0} max={height / 2 - 5} onChange={(v) => setMargin('top', v)} />
          <NumField label="아래" unit="mm" value={m.bottom} min={0} max={height / 2 - 5} onChange={(v) => setMargin('bottom', v)} />
          <NumField label="안쪽(제본 쪽)" unit="mm" value={m.inside} min={0} max={width / 2 - 5} onChange={(v) => setMargin('inside', v)} />
          <NumField label="바깥쪽" unit="mm" value={m.outside} min={0} max={width / 2 - 5} onChange={(v) => setMargin('outside', v)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={showGuides} onChange={(e) => useStore.setState({ showGuides: e.target.checked })} />
          여백 안내선 보기
        </label>
        <p className="hint">여백을 바꾸면 본문은 자동으로 다시 조판돼요. 직접 놓은 글 상자와 이미지는 옮겨지지 않아요.</p>
      </section>
    </>
  );
}

export function RightPanel({ project }: { project: Project }) {
  const currentPage = useStore((s) => s.currentPage);
  const selection = useStore((s) => s.selection);
  const centerView0 = useStore((s) => s.centerView);
  const sf = surfaceOf(project, centerView0, currentPage);
  const page = { id: sf.pageId };
  const selected = sf.elements.filter((e) => selection.includes(e.id));
  const onCover = centerView0 === 'cover';
  const selectedBlock = useStore((s) => s.selectedBlock);
  const centerView = useStore((s) => s.centerView);
  const focus = useStore((s) => s.focus);
  // 원고 보기에서는 글을 쓰고 있는 문단의 속성을 보여 준다
  const blockId = centerView === 'manuscript' ? focus?.id : selectedBlock;
  const block = project.story?.find((b) => b.id === blockId && !b.assetId);
  const expert = useStore((s) => s.expert);
  const hasDesign = !!(project.story && project.master);
  const [tab0, setTab] = useState<'design' | 'doc' | 'print'>('design');
  const tab = tab0 === 'design' && !hasDesign ? 'doc' : tab0;
  return (
    <aside className={`panel right${expert ? '' : ' simple'}`} id="right-panel">
      <div className="mode-switch" title="‘간단히’는 꼭 필요한 설정만, ‘자세히’는 세부 조판·인쇄 설정까지 보여 줘요">
        <button id="mode-simple" className={expert ? '' : 'on'} onClick={() => setExpert(false)}>간단히</button>
        <button id="mode-expert" className={expert ? 'on' : ''} onClick={() => setExpert(true)}>자세히</button>
      </div>
      {selected.length === 1 && selected[0].type === 'rect' && <RectProps el={selected[0]} pageId={page.id} />}
      {selected.length === 0 && onCover && project.cover && <CoverProps project={project} />}
      {selected.length === 0 && onCover && !project.cover && <PrintSettings project={project} />}
      {selected.length === 0 && centerView0 === 'master' && (
        <section><h3>공통 요소</h3><p className="hint">위의 ‘글 상자·이미지·도형’으로 모든 쪽에 깔릴 배경이나 장식을 놓아 보세요. 쪽 번호와 머리말은 ‘페이지’ 보기의 책 디자인에서 설정해요.</p></section>
      )}
      {selected.length === 0 && !onCover && centerView0 !== 'master' && block && <BlockProps block={block} project={project} />}
      {selected.length === 0 && !onCover && centerView0 !== 'master' && !block && (
        <>
          <div className="panel-tabs" role="tablist">
            {hasDesign && <button id="tab-design" className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>디자인</button>}
            <button id="tab-doc" className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}>문서</button>
            <button id="tab-print" className={tab === 'print' ? 'on' : ''} onClick={() => setTab('print')}>인쇄</button>
          </div>
          {tab === 'design' && hasDesign && <BookDesign project={project} />}
          {tab === 'doc' && <><DocumentProps project={project} /><Versions project={project} /></>}
          {tab === 'print' && <PrintSettings project={project} />}
        </>
      )}
      {selected.length === 1 && selected[0].type === 'text' && <TextProps el={selected[0]} pageId={page.id} />}
      {selected.length === 1 && selected[0].type === 'image' && <ImageProps el={selected[0]} pageId={page.id} project={project} />}
      {selected.length > 1 && (
        <section>
          <h3>{selected.length}개 선택됨</h3>
          <p className="hint">끌어서 함께 옮기거나 Delete 키로 지울 수 있어요. 세부 속성은 하나만 선택하면 볼 수 있어요.</p>
        </section>
      )}
    </aside>
  );
}
