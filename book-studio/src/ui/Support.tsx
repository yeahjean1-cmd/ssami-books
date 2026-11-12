import { Component, useEffect, useState, type ReactNode } from 'react';
import { downloadBlob, listSnapshots, safeFilename, type Snapshot } from '../store/storage';
import { mutate, notify, useStore } from '../store/store';
import type { Project } from '../model/types';

declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

interface ErrorEntry { at: string; message: string; stack?: string }

/** 오류를 이 기기에만 기록한다(최근 30건). 원고 내용은 담지 않고, 어디로도 보내지 않는다. */
export function recordError(e: unknown) {
  try {
    const err = e instanceof Error ? e : new Error(String((e as any)?.message ?? e));
    const list: ErrorEntry[] = JSON.parse(localStorage.getItem('bs.errors') ?? '[]');
    list.push({ at: new Date().toISOString(), message: err.message, stack: err.stack?.split('\n').slice(0, 8).join('\n') });
    localStorage.setItem('bs.errors', JSON.stringify(list.slice(-30)));
  } catch {
    /* 기록 실패는 무시한다 */
  }
}

/** 문제 해결에 필요한 정보를 파일로 저장한다. 사용자가 직접 전달할 때만 밖으로 나간다. */
export function saveDiagnostics() {
  const p = useStore.getState().project;
  const info = {
    app: 'Book Studio', version: APP_VERSION, savedAt: new Date().toISOString(), userAgent: navigator.userAgent, language: navigator.language,
    screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    project: p && { pages: p.pages.length, blocks: p.story?.length ?? 0, images: Object.keys(p.assets).length, format: p.format, hasCover: !!p.cover },
    errors: JSON.parse(localStorage.getItem('bs.errors') ?? '[]'),
  };
  downloadBlob(new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' }), `bookstudio-진단-${Date.now()}.json`);
}

function backupProject() {
  const p = useStore.getState().project;
  if (p) downloadBlob(new Blob([JSON.stringify(p)], { type: 'application/json' }), `${safeFilename(p.meta.title)}_백업.bookstudio`);
}

/** 화면을 그리다 오류가 나도 작업을 잃지 않도록 복구 화면을 보여 준다. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    recordError(e);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const has = !!useStore.getState().project;
    return (
      <div className="splash" id="crash-screen">
        <div className="crash">
          <h2>문제가 생겨 화면을 표시하지 못했어요</h2>
          <p>작업 내용은 자동 저장되어 있어요. 아래에서 백업 파일을 받아 둔 뒤 다시 시작해 주세요.<br />같은 문제가 반복되면 진단 정보를 저장해 함께 전달해 주세요. 진단 정보에는 원고 내용이 들어가지 않아요.</p>
          <div className="row">
            {has && <button className="btn" onClick={backupProject}>프로젝트 백업 파일 저장</button>}
            <button className="btn" onClick={saveDiagnostics}>진단 정보 저장</button>
            <button className="btn primary" onClick={() => location.reload()}>다시 시작</button>
          </div>
        </div>
      </div>
    );
  }
}

/** 이전 버전: 자동으로 남겨 둔 복원 지점 목록 */
export function Versions({ project }: { project: Project }) {
  const saveState = useStore((s) => s.saveState);
  const [list, setList] = useState<Snapshot[]>([]);
  useEffect(() => {
    if (saveState === 'saved') listSnapshots(project.id).then(setList, () => setList([]));
  }, [project.id, saveState]);
  return (
    <section>
      <h3>이전 버전</h3>
      {!list.length && <p className="hint">아직 복원 지점이 없어요.</p>}
      <div className="saved-list" id="versions">
        {list.map((v) => (
          <div key={v.key}>
            <span>{new Date(v.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {v.pageCount}쪽</span>
            <button className="btn small" onClick={() => {
              if (!confirm('이 시점의 내용으로 되돌릴까요? (실행 취소로 다시 돌아올 수 있어요)')) return;
              mutate(() => ({ ...v.project }));
              useStore.setState({ selection: [], editingId: null, selectedBlock: null });
              notify('이전 버전으로 되돌렸어요.');
            }}>복원</button>
          </div>
        ))}
      </div>
      <p className="hint">책을 열 때와 편집 중 10분마다 복원 지점을 남겨요(최근 8개). 이 기기에만 저장되니, 중요한 작업은 ‘프로젝트 파일로 저장’으로도 백업해 주세요.</p>
    </section>
  );
}

const GUIDE: [string, string[]][] = [
  ['1. 책 시작하기', [
    '‘원고 가져오기’로 TXT·Word(DOCX)·한글(HWPX, HWP)·RTF 파일을 불러오면 장 제목과 본문을 나누어 자동으로 조판해요. 원고가 없으면 ‘새 책 만들기’로 시작해요.',
    '판형을 모르겠다면 신국판, 인쇄 방식은 양면 인쇄·좌철을 그대로 두면 돼요. 나중에 여백과 디자인은 언제든 바꿀 수 있어요.',
  ]],
  ['2. 글 쓰고 고치기 — ‘원고’ 보기', [
    'Enter로 문단을 나누고, 문단 맨 앞에서 Backspace로 합쳐요. 왼쪽에서 문단 종류(장 제목·절 제목·본문·인용문)를 고르면 디자인이 자동으로 적용돼요.',
    '**굵게**(Ctrl+B), *기울임*(Ctrl+I), __밑줄__, ~~취소선~~, [^각주 내용]을 쓸 수 있어요.',
    '글이 늘거나 줄면 쪽 수, 차례, 쪽 번호가 자동으로 맞춰져요.',
  ]],
  ['3. 디자인 다듬기 — ‘페이지’ 보기', [
    '본문의 문단을 누르면 오른쪽에서 그 종류의 글꼴·크기·간격을 고칠 수 있고, 책 전체에 함께 적용돼요.',
    '빈 곳을 누르면 템플릿, 쪽 번호, 머리말, 여백을 바꿀 수 있어요. ‘글 상자·이미지·도형’으로 원하는 쪽을 자유롭게 꾸밀 수 있어요.',
    '‘공통’ 보기에 놓은 요소는 모든 쪽에 깔리고, 왼쪽 ‘레이어’ 탭에서 요소를 숨기거나 잠글 수 있어요.',
  ]],
  ['4. 표지 만들기 — ‘표지’ 보기', [
    '디자인을 고르면 앞표지·책등·뒤표지가 한 번에 만들어져요. 책등 너비는 쪽수와 종이로 계산한 참고값이니, 인쇄소가 알려 준 값을 직접 입력해 주세요.',
    '빨간 선은 재단선, 바깥 옅은 부분은 도련이에요. 배경은 도련 끝까지, 글자는 초록 점선(안전 영역) 안에 두세요. ‘책 미리보기’로 입체 모습을 볼 수 있어요.',
  ]],
  ['5. 인쇄소에 넘기기', [
    '아래 ‘사전 검사’에서 오류와 경고를 확인해요. 항목을 누르면 해당 위치로 이동해요.',
    '‘PDF 내보내기 → 인쇄용’은 도련과 재단선을 넣고 글자를 CMYK로 내보내요. 인쇄소가 준 ICC 프로파일을 ‘인쇄 설정’에서 불러오면 PDF/X-4로 만들 수 있어요.',
    '첫 인쇄 전에는 반드시 인쇄소의 사전 검사와 교정쇄 확인을 받아 주세요.',
  ]],
  ['6. 저장과 복구', [
    '작업은 이 기기에 자동 저장돼요. 다른 기기로 옮기거나 백업할 때는 ‘프로젝트 파일로 저장’을 쓰세요.',
    '‘페이지’ 보기에서 빈 곳을 누르면 오른쪽 아래 ‘이전 버전’에서 예전 상태로 되돌릴 수 있어요. Ctrl+Z로 실행 취소, Ctrl+S로 바로 저장해요.',
  ]],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="도움말" id="help">
        <div className="modal-head"><h2>Book Studio 사용 안내</h2><p className="modal-sub">버전 {APP_VERSION}</p></div>
        <div className="modal-body guide">
          {GUIDE.map(([title, items]) => (
            <section key={title}><h3>{title}</h3><ul>{items.map((t) => <li key={t}>{t}</li>)}</ul></section>
          ))}
          <section>
            <h3>문제가 생겼을 때</h3>
            <ul><li>진단 정보에는 프로그램 버전, 화면 크기, 최근 오류 기록만 들어가고 원고 내용은 들어가지 않아요. 이 프로그램은 어떤 정보도 스스로 밖으로 보내지 않아요.</li></ul>
            <button className="btn small" id="save-diagnostics" onClick={saveDiagnostics}>진단 정보 저장</button>
          </section>
          <section>
            <h3>서체와 저작권</h3>
            <ul>
              <li>기본 서체(프리텐다드, 나눔명조)는 SIL Open Font License로 상업 출판에 쓸 수 있어요.</li>
              <li>직접 추가한 폰트와 이미지는 사용 범위(인쇄·출판 허용 여부)를 꼭 확인해 주세요. PDF 포함이 금지된 폰트는 추가되지 않아요.</li>
            </ul>
          </section>
        </div>
        <div className="modal-foot"><div className="spacer" /><button className="btn primary" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}
