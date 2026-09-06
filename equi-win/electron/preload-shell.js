'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('equiShell', {
  getState: () => ipcRenderer.invoke('doc:getState'),
  open: () => ipcRenderer.invoke('doc:open'),
  save: () => ipcRenderer.invoke('doc:save'),
  saveAs: () => ipcRenderer.invoke('doc:saveAs'),
  newWindow: () => ipcRenderer.invoke('app:newWindow'),
  sendCommand: (command) => ipcRenderer.send('editor:command', command),
  forwardBridge: (payload) => ipcRenderer.send('editor:bridge', payload),
  reportGuestId: (id) => ipcRenderer.send('editor:guestId', id),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('doc:state', handler);
    return () => ipcRenderer.removeListener('doc:state', handler);
  },
  platform: process.platform,
});
