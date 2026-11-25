// Mac app shell: serves the same web app (../app) from a private, secure app:// origin.
const { app, BrowserWindow, protocol, net, shell, session, powerMonitor } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'app');
const ORIGIN = 'app://piekluves';

// A secure standard scheme gives WebCrypto, localStorage and fetch() a stable origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 380,
    minHeight: 500,
    title: 'Piekļuves',
    backgroundColor: '#0b0b0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadURL(`${ORIGIN}/index.html`);

  // Never navigate away from the app; open external links in the default browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
    if (!file.startsWith(WEB + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'clipboard-sanitized-write');
  });

  // Lock the vault when the Mac sleeps or the screen locks.
  const lockVault = () => win?.webContents.send('lock');
  powerMonitor.on('lock-screen', lockVault);
  powerMonitor.on('suspend', lockVault);

  createWindow();
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
