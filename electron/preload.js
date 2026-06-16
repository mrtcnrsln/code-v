const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codevElectron', {
  getServerPort:    () => ipcRenderer.invoke('get-server-port'),
  getPlatform:      () => ipcRenderer.invoke('get-platform'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  isElectron: true
});
