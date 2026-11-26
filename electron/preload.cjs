const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('velowriteDesktop', {
  getAppInfo: () => ipcRenderer.invoke('velowrite:get-app-info'),
  checkForUpdates: () => ipcRenderer.invoke('velowrite:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('velowrite:install-update'),
  openFile: () => ipcRenderer.invoke('velowrite:open-file'),
  saveFile: (payload) => ipcRenderer.invoke('velowrite:save-file', payload),
  exportPdf: (payload) => ipcRenderer.invoke('velowrite:export-pdf', payload),
  chooseSyncFolder: () => ipcRenderer.invoke('velowrite:choose-sync-folder'),
  syncWriteDoc: (payload) => ipcRenderer.invoke('velowrite:sync-write-doc', payload),
  syncReadAll: (payload) => ipcRenderer.invoke('velowrite:sync-read-all', payload),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('velowrite:update-status', handler);
    return () => ipcRenderer.removeListener('velowrite:update-status', handler);
  },
});
