import { useEffect, useState } from 'react';
import { createProject, parseProjectFile, uid, type NewProjectInput } from '../model/factory';
import { CUSTOM_PRESET_ID, FORMAT_PRESETS, presetName, recommendedMargins } from '../model/presets';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from '../store/storage';
import { notify, openProject } from '../store/store';
import { NumField, Segmented, pickFile, readFile } from './fields';

async function openFromFile(refresh: () => void) {
  const file = await pickFile('.bookstudio,.json');
  if (!file) return;
  try {
    const project = parseProjectFile(await readFile(file, 'text'));
    // 같은 책이 이미 있으면 덮어쓰지 않도록 사본으로 연다
    if (await loadProject(project.id)) project.id = uid();
    project.updatedAt = Date.now();
    await saveProject(project);
    openProject(project);
  } catch (e) {
    notify(e instanceof Error ? e.message : '프로젝트 파일을 열지 못했어요.', 'error');
    refresh();
  }
}

function Wizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<NewProjectInput>({
    title: '', subtitle: '', author: '', publisher: '', presetId: 'shinkuk', width: 152, height: 225,
    duplex: true, binding: 'left', margins: recommendedMargins(152, 225),
  });
  const [landscape, setLandscape] = useState(false);
  const [customMargins, setCustomMargins] = useState(false);
  const up = (patch: Partial<NewProjectInput>) => setF((v) => {
    const next = { ...v, ...patch };
    if (!customMargins && (patch.width || patch.height)) next.margins = recommendedMargins(next.width, next.height);
    return next;
  });
  const pickPreset = (id: string, land = landscape) => {
    const p = FORMAT_PRESETS.find((x) => x.id === id);
    if (!p) return up({ presetId: CUSTOM_PRESET_ID });
    up({ presetId: id, width: land ? p.height : p.width, height: land ? p.width : p.height });
  };
  const steps = ['책 정보', '판형', '인쇄와 여백'];
  const k = 150 / Math.max(f.width, f.height);
  const m = f.margins;

  const finish = async () => {
    const project = createProject(f);
    await saveProject(project);
    openProject(project);
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="새 책 만들기">
        <div className="modal-head">
          <h2>새 책 만들기</h2>
          <ol className="steps">{steps.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</li>)}</ol>
        </div>

        <div className="modal-body">
          {step === 0 && (
            <div className="form">
              <label className="field"><span>책 제목</span><input id="w-title" autoFocus value={f.title} placeholder="예: 느리게 걷는 마음" onChange={(e) => up({ title: e.target.value })} /></label>
              <label className="field"><span>부제 (선택)</span><input id="w-subtitle" value={f.subtitle} onChange={(e) => up({ subtitle: e.target.value })} /></label>
              <label className="field"><span>저자 (선택)</span><input id="w-author" value={f.author} onChange={(e) => up({ author: e.target.value })} /></label>
              <label className="field"><span>출판사 (선택)</span><input value={f.publisher} onChange={(e) => up({ publisher: e.target.value })} /></label>
              <p className="hint">입력한 정보로 첫 쪽(속표지)을 만들어 드려요. 나중에 언제든 바꿀 수 있어요.</p>
            </div>
          )}

          {step === 1 && (
            <div className="format-step">
              <div className="presets">
                {FORMAT_PRESETS.map((p) => (
                  <button key={p.id} className={`preset${f.presetId === p.id ? ' on' : ''}`} data-preset={p.id} onClick={() => pickPreset(p.id)}>
                    <i style={{ width: p.width / 6, height: p.height / 6 }} />
                    <strong>{p.name}</strong>
                    <span>{p.width} × {p.height}mm</span>
                    <small>{p.hint}</small>
                  </button>
                ))}
                <button className={`preset${f.presetId === CUSTOM_PRESET_ID ? ' on' : ''}`} data-preset="custom" onClick={() => up({ presetId: CUSTOM_PRESET_ID })}>
                  <i className="custom" style={{ width: 26, height: 36 }} />
                  <strong>사용자 지정</strong>
                  <span>직접 입력</span>
                  <small>원하는 크기로 만들어요</small>
                </button>
              </div>
              <div className="form narrow">
                {f.presetId === CUSTOM_PRESET_ID ? (
                  <div className="grid2">
                    <NumField id="w-width" label="너비" unit="mm" value={f.width} min={50} max={600} onChange={(width) => up({ width })} />
                    <NumField id="w-height" label="높이" unit="mm" value={f.height} min={50} max={600} onChange={(height) => up({ height })} />
                  </div>
                ) : (
                  <Segmented label="방향" value={landscape ? 'l' : 'p'} options={[{ value: 'p', label: '세로형' }, { value: 'l', label: '가로형' }]}
                    onChange={(v) => { setLandscape(v === 'l'); pickPreset(f.presetId, v === 'l'); }} />
                )}
                <p className="hint">
                  완성 크기(재단 후) <b>{f.width} × {f.height}mm</b><br />
                  잘 모르겠다면 단행본에 가장 많이 쓰는 <b>신국판</b>을 추천해요.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="format-step">
              <div className="form">
                <Segmented label="인쇄 방식" value={f.duplex ? 'd' : 's'} options={[{ value: 'd', label: '양면 인쇄' }, { value: 's', label: '단면 인쇄' }]}
                  onChange={(v) => up({ duplex: v === 'd' })} />
                <Segmented label="제본 방향" value={f.binding} options={[{ value: 'left', label: '좌철 (가로쓰기 책)' }, { value: 'right', label: '우철' }]}
                  onChange={(binding) => up({ binding })} />
                <p className="hint">일반적인 가로쓰기 책은 <b>양면 인쇄 · 좌철</b>이에요. 왼쪽을 묶어 오른쪽에서 왼쪽으로 넘겨요.</p>
                <div className="grid2">
                  <NumField label="위 여백" unit="mm" value={m.top} min={0} max={f.height / 2 - 5} onChange={(top) => { setCustomMargins(true); up({ margins: { ...m, top } }); }} />
                  <NumField label="아래 여백" unit="mm" value={m.bottom} min={0} max={f.height / 2 - 5} onChange={(bottom) => { setCustomMargins(true); up({ margins: { ...m, bottom } }); }} />
                  <NumField label="안쪽(제본 쪽)" unit="mm" value={m.inside} min={0} max={f.width / 2 - 5} onChange={(inside) => { setCustomMargins(true); up({ margins: { ...m, inside } }); }} />
                  <NumField label="바깥쪽" unit="mm" value={m.outside} min={0} max={f.width / 2 - 5} onChange={(outside) => { setCustomMargins(true); up({ margins: { ...m, outside } }); }} />
                </div>
                <button className="btn small" onClick={() => { setCustomMargins(false); up({ margins: recommendedMargins(f.width, f.height) }); }}>추천 여백으로 되돌리기</button>
                <p className="hint">안쪽 여백은 책이 묶이는 쪽이라 바깥쪽보다 조금 넓게 잡아요.</p>
              </div>
              <div className="margin-preview" aria-label="여백 미리보기">
                {(f.duplex ? [false, true] : [true]).map((rightPage) => {
                  const insideLeft = rightPage === (f.binding === 'left');
                  // 양면일 때 화면 왼쪽 쪽은 제본 쪽이 오른쪽에 있다
                  const left = (f.duplex ? rightPage : insideLeft) ? m.inside : m.outside;
                  return (
                    <div key={String(rightPage)} className="mp-page" style={{ width: f.width * k, height: f.height * k }}>
                      <div style={{ left: left * k, top: m.top * k, width: (f.width - m.inside - m.outside) * k, height: (f.height - m.top - m.bottom) * k }} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <div className="spacer" />
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>이전</button>}
          {step < 2
            ? <button className="btn primary" id="w-next" onClick={() => setStep(step + 1)}>다음</button>
            : <button className="btn primary" id="w-create" onClick={finish}>책 만들기</button>}
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [wizard, setWizard] = useState(false);
  const refresh = () => listProjects().then(setList, () => setList([]));
  useEffect(() => { refresh(); }, []);

  const open = async (id: string) => {
    const p = await loadProject(id);
    if (p) openProject(p);
    else notify('프로젝트를 찾을 수 없어요.', 'error');
  };
  const remove = async (s: ProjectSummary) => {
    if (!confirm(`‘${s.title}’을(를) 삭제할까요? 삭제하면 되돌릴 수 없어요.`)) return;
    await deleteProject(s.id);
    refresh();
  };

  return (
    <div className="home">
      <header>
        <div className="brand">Book Studio</div>
        <p>원고에서 인쇄용 PDF까지, 한 권의 책을 만드는 곳</p>
      </header>
      <main>
        <div className="home-actions">
          <button className="btn primary large" id="new-book" onClick={() => setWizard(true)}>새 책 만들기</button>
          <button className="btn large" id="open-file" onClick={() => openFromFile(refresh)}>프로젝트 파일 열기</button>
        </div>
        <h2>최근 프로젝트</h2>
        {list && list.length === 0 && <p className="empty">아직 만든 책이 없어요. ‘새 책 만들기’로 첫 책을 시작해 보세요.</p>}
        <div className="projects">
          {list?.map((s) => (
            <div key={s.id} className="project-card">
              <button className="cover" onClick={() => open(s.id)} style={{ aspectRatio: `${s.width} / ${s.height}` }}>
                <strong>{s.title}</strong>
                {s.author && <span>{s.author}</span>}
              </button>
              <div className="project-meta">
                <div>
                  <b>{s.title}</b>
                  <small>{presetName(s.presetId)} · {s.pageCount}쪽 · {new Date(s.updatedAt).toLocaleDateString('ko-KR')}</small>
                </div>
                <button className="btn ghost small" onClick={() => remove(s)} aria-label={`${s.title} 삭제`}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      </main>
      {wizard && <Wizard onClose={() => setWizard(false)} />}
    </div>
  );
}
