const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('fs/promises');
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

  /* ==================== NATIVE DISK FILE SYSTEM ==================== */

  ipcMain.handle('velowrite:open-file', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Document',
      properties: ['openFile'],
      filters: [
        { name: 'VeloWrite & Markdown', extensions: ['md', 'markdown', 'json', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');
    return {
      filePath,
      fileName: path.basename(filePath),
      content,
    };
  });

  ipcMain.handle('velowrite:save-file', async (_event, payload) => {
    if (!mainWindow) return { canceled: true };
    let targetPath = payload.filePath;
    if (!targetPath) {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Document',
        defaultPath: payload.defaultName || 'document.md',
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'VeloWrite JSON', extensions: ['json'] },
          { name: 'Plain Text', extensions: ['txt'] },
        ],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      targetPath = res.filePath;
    }
    const content = targetPath.endsWith('.json')
      ? payload.jsonContent
      : payload.markdownContent;
    await fs.writeFile(targetPath, content, 'utf8');
    return {
      canceled: false,
      filePath: targetPath,
      fileName: path.basename(targetPath),
    };
  });

  ipcMain.handle('velowrite:export-pdf', async (_event, payload) => {
    if (!mainWindow) return { canceled: true };
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export PDF',
      defaultPath: payload.defaultName || 'document.pdf',
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const pdfBuffer = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: payload.pageSize === 'a4' ? 'A4' : 'Letter',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await fs.writeFile(res.filePath, pdfBuffer);
    return { canceled: false, filePath: res.filePath };
  });

  /* ==================== FOLDER-BACKED SYNC ==================== */

  ipcMain.handle('velowrite:choose-sync-folder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Sync Folder (iCloud, OneDrive, Dropbox, Syncthing)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('velowrite:sync-write-doc', async (_event, { folderPath, docId, json }) => {
    if (!folderPath || !docId) return false;
    const safeId = String(docId).replace(/[^a-zA-Z0-9_-]/g, '');
    const target = path.join(folderPath, `${safeId}.velowrite.json`);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, target);
    return true;
  });

  ipcMain.handle('velowrite:sync-read-all', async (_event, { folderPath }) => {
    if (!folderPath) return [];
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      const docs = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.velowrite.json')) {
          const raw = await fs.readFile(path.join(folderPath, entry.name), 'utf8');
          docs.push(raw);
        }
      }
      return docs;
    } catch {
      return [];
    }
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
