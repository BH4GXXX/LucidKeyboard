const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onKeyDown: (cb) => ipcRenderer.on('key-down', (_e, id) => cb(id)),
  onKeyUp: (cb) => ipcRenderer.on('key-up', (_e, id) => cb(id)),
  onMouseMove: (cb) => ipcRenderer.on('mouse-move', () => cb()),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onToggleHide: (cb) => ipcRenderer.on('toggle-hide', () => cb()),
  onLockHot: (cb) => ipcRenderer.on('lock-hot', (_e, hot) => cb(hot)),
  command: (name, value) => ipcRenderer.send('command', { name, value }),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  lockDragMove: (dx, dy) => ipcRenderer.send('lock-drag-move', { dx, dy }),
  lockDragEnd: () => ipcRenderer.send('lock-drag-end'),
});
