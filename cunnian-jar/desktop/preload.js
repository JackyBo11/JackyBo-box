const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  close: () => ipcRenderer.send('win:close'),
  minimize: () => ipcRenderer.send('win:min'),
  maximize: () => ipcRenderer.send('win:max')
});
