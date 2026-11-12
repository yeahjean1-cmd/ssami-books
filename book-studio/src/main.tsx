import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadBuiltinFonts, registerFontData } from './engine/fonts';
import { listFonts } from './store/storage';
import { useStore } from './store/store';
import { Editor } from './ui/Editor';
import { Home } from './ui/Home';
import { ErrorBoundary, recordError } from './ui/Support';
import './styles.css';

function App() {
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      await loadBuiltinFonts();
      for (const f of await listFonts().catch(() => [])) {
        try {
          registerFontData(f.family, f.bold, f.data);
        } catch {
          /* 손상된 사용자 폰트는 건너뛴다 */
        }
      }
    })().then(() => setReady(true), (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div className="splash">프로그램을 시작하지 못했어요.<br />{error}</div>;
  if (!ready) return <div className="splash">서체를 준비하고 있어요…</div>;
  return (
    <>
      {project ? <Editor project={project} /> : <Home />}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

// 처리되지 않은 오류는 이 기기에만 기록해 두었다가 진단 정보로 저장할 수 있게 한다
window.addEventListener('error', (e) => recordError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => recordError(e.reason));

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
