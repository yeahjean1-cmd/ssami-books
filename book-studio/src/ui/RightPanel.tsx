import { FontError, inspectFontFile, listFamilies, registerFontData } from '../engine/fonts';
import { effectiveDpi, resolveText } from '../engine/render';
import { round1 } from '../engine/units';
import { presetName } from '../model/presets';
import type { ImageElement, PageElement, Project, TextElement, TextStyle } from '../model/types';
import { saveFont } from '../store/storage';
import { mutate, notify, patchElements, reorderSelection, useStore } from '../store/store';
import { NumField, Segmented, pickFile, readFile } from './fields';
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
      <div className="row">
        <button className="btn" onClick={() => reorderSelection('front')}>맨 앞으로</button>
        <button className="btn" onClick={() => reorderSelection('back')}>맨 뒤로</button>
      </div>
    </section>
  );
}

function TextProps({ el, pageId }: { el: TextElement; pageId: string }) {
  useFontsVersion();
  const s = el.style;
  const set = (patch: Partial<TextStyle>, key: string) =>
    patchElements(pageId, { [el.id]: { style: { ...s, ...patch } } }, { coalesce: `${key}:${el.id}` });
  const res = resolveText(el);
  const families = listFamilies();
  const current = families.find((f) => f.family === s.fontFamily);
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
          <NumField label="자간" unit="‰" value={s.letterSpacing} min={-200} max={1000} step={5} onChange={(letterSpacing) => set({ letterSpacing }, 'ls')} />
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
          <NumField label="문단 간격" unit="mm" value={s.paraSpacing} min={0} max={50} step={0.5} onChange={(paraSpacing) => set({ paraSpacing }, 'ps')} />
        </div>
        <Segmented label="줄바꿈" value={s.wordBreak} onChange={(wordBreak) => set({ wordBreak }, 'wb')}
          options={[{ value: 'char', label: '글자 단위' }, { value: 'word', label: '낱말 단위' }]} />
        <p className="hint">책 본문은 보통 ‘글자 단위’와 ‘양쪽’ 정렬을 써요. 문장부호가 줄 처음에 오지 않도록 자동으로 처리돼요.</p>
      </section>
      <Geometry el={el} pageId={pageId} />
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
        <p className="hint">여백은 새로 만드는 글 상자와 안내선의 기준이에요. 이미 놓인 요소는 자동으로 옮겨지지 않아요.</p>
      </section>
    </>
  );
}

export function RightPanel({ project }: { project: Project }) {
  const currentPage = useStore((s) => s.currentPage);
  const selection = useStore((s) => s.selection);
  const page = project.pages[currentPage];
  const selected = page.elements.filter((e) => selection.includes(e.id));
  return (
    <aside className="panel right" id="right-panel">
      {selected.length === 0 && <DocumentProps project={project} />}
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
