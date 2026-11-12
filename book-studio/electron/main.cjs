// Book Studio 데스크톱 실행 껍데기. 빌드된 화면(dist)을 자체 프로토콜로 불러와 오프라인으로 동작한다.
const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f7f4ee',
    title: 'Book Studio',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // 외부 링크는 앱 안에서 열지 않는다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.loadURL('app://book-studio/index.html');
}

// 같은 책을 두 창에서 동시에 고쳐 저장이 엇갈리지 않도록 한 번만 실행한다
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/** 설치된 프로그램에서만 새 버전을 확인한다. 배포 서버(GitHub 릴리스)에 새 판이 없거나 연결이 안 되면 조용히 넘어간다. */
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    /* 업데이트 모듈이 없으면 건너뛴다 */
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  checkForUpdates();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
