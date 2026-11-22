const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  close: () => ipcRenderer.send('win:close'),
  minimize: () => ipcRenderer.send('win:min'),
  maximize: () => ipcRenderer.send('win:max'),
  dragStart: (x, y) => ipcRenderer.send('win:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('win:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('win:drag-end')
});
