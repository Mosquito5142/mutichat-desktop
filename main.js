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

// Set a dedicated custom userData directory to avoid SQLite file locking & QuotaDB IO errors on Windows
const customUserDataDir = path.join(app.getPath('userData'), 'MultiChat_Data_Store');
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
  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_USER_AGENT);
    
    // Allow Facebook login popups/oauth within the same webview
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

app.whenReady().then(() => {
  // Override User-Agent on all sessions dynamically
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
    callback({ requestHeaders: details.requestHeaders });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler to flash taskbar when new message arrives
ipcMain.on('flash-taskbar', (event) => {
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});


