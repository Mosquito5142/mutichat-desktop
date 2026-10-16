const { app, BrowserWindow, ipcMain, shell, session, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Focus existing window if user attempts to launch a second instance
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Set a dedicated custom userData directory to avoid SQLite file locking & QuotaDB IO errors on Windows.
// The default userData folder is named after the app, which differs between `npm start`, the packager
// build and the installer build — pin it so every build shares the same logins and quick replies.
const DATA_STORE_NAME = 'MultiChat_Data_Store';
function resolveDataStoreDir() {
  const appData = app.getPath('appData');
  // This build's own folder first (unchanged behaviour), then the names other builds use
  const candidates = [...new Set([
    app.getPath('userData'),
    path.join(appData, 'multi-account-messenger'),
    path.join(appData, 'Multi-Chat Messenger'),
    path.join(appData, 'Multi-Chat-Messenger')
  ])].map(base => path.join(base, DATA_STORE_NAME));
  return candidates.find(dir => fs.existsSync(dir)) || candidates[0];
}
const customUserDataDir = resolveDataStoreDir();
if (!fs.existsSync(customUserDataDir)) {
  fs.mkdirSync(customUserDataDir, { recursive: true });
}
app.setPath('userData', customUserDataDir);

// Force Dark Theme
nativeTheme.themeSource = 'dark';

// Prevent GPU disk cache & SQLite lock conflicts on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');

let mainWindow;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'Multi-Chat Messenger - Dual Account',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      partition: 'persist:main'
    },
    autoHideMenuBar: true,
    backgroundColor: '#0f172a'
  });

  mainWindow.loadFile('index.html');

  // Confirm close & force clean exit so background processes don't linger
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['ออกจากโปรแกรม', 'ยกเลิก'],
        defaultId: 0,
        cancelId: 1,
        title: 'ยืนยันการปิดโปรแกรม',
        message: 'คุณต้องการออกจากโปรแกรม Multi-Chat ใช่หรือไม่?',
        detail: 'การปิดโปรแกรมจะทำการปิดทุกลิงก์บัญชีและคืนทรัพยากร RAM ทั้งหมด'
      });

      if (choice === 0) {
        isQuitting = true;
        app.exit(0); // Clean, immediate kill of all worker processes & file locks
      }
    }
  });

  // Stop flashing taskbar when user clicks or focuses the app window
  mainWindow.on('focus', () => {
    if (mainWindow) {
      mainWindow.flashFrame(false);
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Global user agent for messenger compatibility (strips Electron signature)
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

app.on('web-contents-created', (event, contents) => {
  // Ctrl+Shift+Y toggles YouTube even when a chat/YouTube webview has keyboard focus
  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    if (input.shift && input.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (mainWindow) mainWindow.webContents.send('toggle-youtube');
      return;
    }
    // Ctrl + / Ctrl - / Ctrl 0 zoom the pane that has focus (handled per account in the renderer)
    if (contents.getType() === 'webview') {
      const zoomAction = { '=': 'in', '+': 'in', '-': 'out', '_': 'out', '0': 'reset' }[input.key];
      if (zoomAction) {
        e.preventDefault();
        if (mainWindow) mainWindow.webContents.send('zoom-pane', contents.id, zoomAction);
      }
    }
  });

  // Ctrl + mouse wheel / touchpad pinch
  if (contents.getType() === 'webview') {
    contents.on('zoom-changed', (e, direction) => {
      if (mainWindow) mainWindow.webContents.send('zoom-pane', contents.id, direction);
    });
  }

  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_USER_AGENT);
    
    // Allow Facebook login popups/oauth within the same webview
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

// Network-level ad blocking for the YouTube session only (chat sessions untouched).
// The `urls` filter means the callback runs only for matching requests, so it costs nothing elsewhere.
const YT_AD_URL_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://www.youtube.com/pagead/*',
  '*://www.youtube.com/api/stats/ads*',
  '*://www.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_*'
];

function setupYoutubeAdBlock() {
  const ytSession = session.fromPartition('persist:youtube');
  ytSession.setUserAgent(CHROME_USER_AGENT);
  ytSession.webRequest.onBeforeRequest({ urls: YT_AD_URL_PATTERNS }, (details, callback) => {
    callback({ cancel: true });
  });
}

app.whenReady().then(() => {
  // Override User-Agent on all sessions dynamically
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
    callback({ requestHeaders: details.requestHeaders });
  });

  setupYoutubeAdBlock();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler to flash taskbar when new message arrives
// Bring the app to the front (e.g. "back to tab" from the YouTube PiP window)
ipcMain.on('focus-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

ipcMain.on('flash-taskbar', (event) => {
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});


