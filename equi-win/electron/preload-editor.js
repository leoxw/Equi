'use strict';

/** 编辑器 webview preload：模拟 macOS webkit.messageHandlers.editorBridge。 */
const { contextBridge, ipcRenderer } = require('electron');

function postMessage(payload) {
  try {
    ipcRenderer.sendToHost('editorBridge', payload);
  } catch (err) {
    console.warn('[equi-preload] sendToHost failed', err);
  }
}

contextBridge.exposeInMainWorld('__EQUI_EDITOR__', {
  platform: 'windows',
  app: 'Equi',
  bridgeReady: true,
});

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    editorBridge: { postMessage },
  },
});

contextBridge.exposeInMainWorld('equiNative', {
  postMessage,
});

window.addEventListener('error', (ev) => {
  try {
    postMessage({
      type: 'log',
      message: `JSError: ${ev.message} @${ev.filename || ''}:${ev.lineno || 0}`,
    });
  } catch (_) {
    /* ignore */
  }
});
