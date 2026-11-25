const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('velowrite:update-status', payload);
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      status: 'available',
      version: info.version,
      releaseName: info.releaseName || `v${info.version}`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus({
      status: 'up-to-date',
      version: info.version,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      status: 'downloading',
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      status: 'downloaded',
      version: info.version,
      releaseName: info.releaseName || `v${info.version}`,
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus({
      status: 'error',
      message: err ? String(err.message || err) : 'Update check failed',
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 780,
    minHeight: 540,
    title: 'VeloWrite',
    backgroundColor: '#f5f4f0',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('velowrite:get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    repoUrl: 'https://github.com/halxo/velowrite',
  }));

  ipcMain.handle('velowrite:check-for-updates', async () => {
    if (!app.isPackaged) {
      sendUpdateStatus({
        status: 'up-to-date',
        version: app.getVersion(),
        message: 'Auto-updater runs in packaged desktop builds',
      });
      return { ok: true, packaged: false };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, packaged: true };
    } catch (err) {
      const message = err ? String(err.message || err) : 'Update check failed';
      sendUpdateStatus({ status: 'error', message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('velowrite:install-update', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    configureAutoUpdater();
    createWindow();

    if (app.isPackaged) {
      setTimeout(() => {
        void autoUpdater.checkForUpdates().catch(() => {});
      }, 3000);

      setInterval(() => {
        void autoUpdater.checkForUpdates().catch(() => {});
      }, 4 * 60 * 60 * 1000);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
