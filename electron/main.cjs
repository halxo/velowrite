const { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.velowrite']);

let mainWindow = null;
let rendererReady = false;
let pendingOpenFilePath = null;
let windowStateTimer = null;

/* ==================== DIAGNOSTIC CRASH-SAFE LOGGER ==================== */

function writeLog(level, message, detail) {
  try {
    const dir = app.getPath('userData');
    const logPath = path.join(dir, 'velowrite.log');
    const line = `[${new Date().toISOString()}] [${level}] ${message}${
      detail ? ` :: ${detail}` : ''
    }\n`;
    try {
      const stat = fsSync.statSync(logPath);
      if (stat.size > 1024 * 1024) {
        fsSync.renameSync(logPath, `${logPath}.1`);
      }
    } catch {
      // Log file does not exist yet
    }
    fsSync.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Never throw from logger
  }
}

process.on('uncaughtException', (err) => {
  writeLog('ERROR', 'UncaughtException', err && err.stack ? err.stack : String(err));
});

process.on('unhandledRejection', (reason) => {
  writeLog('WARN', 'UnhandledRejection', String(reason));
});

/* ==================== PERSISTENT WINDOW BOUNDS ==================== */

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const defaults = { width: 1320, height: 860, isMaximized: false };
  try {
    const raw = fsSync.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const width = Math.max(780, Number(parsed.width) || defaults.width);
    const height = Math.max(540, Number(parsed.height) || defaults.height);

    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      const displays = screen.getAllDisplays();
      const visible = displays.some((d) => {
        const b = d.bounds;
        return (
          parsed.x >= b.x - 100 &&
          parsed.y >= b.y - 100 &&
          parsed.x < b.x + b.width - 100 &&
          parsed.y < b.y + b.height - 100
        );
      });
      if (visible) {
        return {
          x: parsed.x,
          y: parsed.y,
          width,
          height,
          isMaximized: Boolean(parsed.isMaximized),
        };
      }
    }
    return { width, height, isMaximized: Boolean(parsed.isMaximized) };
  } catch {
    return defaults;
  }
}

function scheduleSaveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const isMaximized = mainWindow.isMaximized();
      const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      fsSync.writeFileSync(
        getWindowStatePath(),
        JSON.stringify({ ...bounds, isMaximized }),
        'utf8'
      );
    } catch {
      // Ignore transient disk write failures
    }
  }, 300);
}

/* ==================== FILE ASSOCIATION / CLI PARSING ==================== */

function extractFilePathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || arg.startsWith('-')) continue;
    const ext = path.extname(arg).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext) && fsSync.existsSync(arg)) {
      return path.resolve(arg);
    }
  }
  return null;
}

async function dispatchExternalFileToRenderer(filePath) {
  if (!filePath) return;
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) {
    pendingOpenFilePath = filePath;
    return;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    mainWindow.webContents.send('velowrite:external-file-opened', {
      filePath,
      fileName: path.basename(filePath),
      content,
    });
  } catch (err) {
    writeLog('WARN', 'Failed to open external file', String(err));
  }
}

/* ==================== NATIVE MENU BAR (MACOS + SHORTCUTS) ==================== */

function buildNativeMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Check for Updates…',
                click: () => {
                  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {});
                },
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ==================== GITHUB RELEASES AUTO-UPDATER ==================== */

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
    const msg = err ? String(err.message || err) : 'Update check failed';
    writeLog('WARN', 'AutoUpdaterError', msg);
    sendUpdateStatus({
      status: 'error',
      message: msg,
    });
  });
}

/* ==================== WINDOW LIFECYCLE ==================== */

function createWindow() {
  const winState = loadWindowState();
  rendererReady = false;

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
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

  if (winState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('close', scheduleSaveWindowState);

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog('ERROR', 'RendererProcessGone', JSON.stringify(details));
    if (mainWindow && !mainWindow.isDestroyed() && details.reason !== 'clean-exit') {
      mainWindow.reload();
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
    rendererReady = false;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('velowrite:renderer-ready', async () => {
    rendererReady = true;
    if (pendingOpenFilePath) {
      const target = pendingOpenFilePath;
      pendingOpenFilePath = null;
      await dispatchExternalFileToRenderer(target);
    }
    return true;
  });

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
        { name: 'VeloWrite & Markdown', extensions: ['md', 'markdown', 'velowrite', 'json', 'txt'] },
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
          { name: 'VeloWrite Document', extensions: ['velowrite', 'json'] },
          { name: 'Plain Text', extensions: ['txt'] },
        ],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      targetPath = res.filePath;
    }
    const content =
      targetPath.endsWith('.json') || targetPath.endsWith('.velowrite')
        ? payload.jsonContent
        : payload.markdownContent;
    const tmpPath = `${targetPath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, targetPath);
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

/* ==================== APP BOOTSTRAP ==================== */

const initialCliFile = extractFilePathFromArgv(process.argv);
if (initialCliFile) {
  pendingOpenFilePath = initialCliFile;
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  void dispatchExternalFileToRenderer(filePath);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const secondFile = extractFilePathFromArgv(commandLine);
    if (secondFile) {
      void dispatchExternalFileToRenderer(secondFile);
    }
  });

  app.whenReady().then(() => {
    buildNativeMenu();
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
