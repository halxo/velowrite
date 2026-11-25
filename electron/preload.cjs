const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('velowriteDesktop', {
  getAppInfo: () => ipcRenderer.invoke('velowrite:get-app-info'),
  checkForUpdates: () => ipcRenderer.invoke('velowrite:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('velowrite:install-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('velowrite:update-status', handler);
    return () => ipcRenderer.removeListener('velowrite:update-status', handler);
  },
});
