'use strict';

const webview = document.getElementById('editor');
const banner = document.getElementById('banner');
const titleEl = document.getElementById('doc-title');
const dirtyLabel = document.getElementById('dirty-label');
const pathLabel = document.getElementById('path-label');
const kindLabel = document.getElementById('kind-label');
const statsLabel = document.getElementById('stats-label');
const readyLabel = document.getElementById('ready-label');
const btnSave = document.getElementById('btn-save');

function q(name) {
  return new URLSearchParams(location.search).get(name);
}

function toFileUrl(p) {
  if (!p) return '';
  if (p.startsWith('file:')) return p;
  const n = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(n)) return `file:///${n}`;
  return `file://${n.startsWith('/') ? '' : '/'}${n}`;
}

function editorSrc() {
  const fromQuery = q('editor');
  if (fromQuery) return toFileUrl(fromQuery);
  return new URL('../resources/EquiEditor.html', location.href).href;
}

function preloadSrc() {
  const fromQuery = q('preload');
  if (fromQuery) return toFileUrl(fromQuery);
  return new URL('../electron/preload-editor.js', location.href).href;
}

function applyState(next) {
  if (!next) return;
  document.body.classList.toggle('mode-plain', next.kind?.webMode === 'plain');
  titleEl.textContent = next.displayTitle || '未命名';
  dirtyLabel.textContent = next.isDirty ? '未保存' : '已保存';
  dirtyLabel.classList.toggle('dirty', !!next.isDirty);
  pathLabel.textContent = next.filePath || '内存文档';
  pathLabel.title = next.filePath || '';
  kindLabel.textContent = next.kind?.statusLabel || 'Markdown';
  statsLabel.textContent = `${next.wordCount || 0} 词 · ${next.characterCount || 0} 字符`;

  if (next.editorLoadError) {
    banner.hidden = false;
    banner.className = 'banner';
    banner.textContent = next.editorLoadError;
    readyLabel.textContent = '加载失败';
  } else if (!next.isEditorReady) {
    banner.hidden = false;
    banner.className = 'banner loading';
    banner.textContent = '正在加载编辑器…';
    readyLabel.textContent = '加载中…';
  } else {
    banner.hidden = true;
    readyLabel.textContent = '';
  }
  if (btnSave) btnSave.disabled = !next.isDirty && !!next.filePath;
}

window.__equiEvalEditor = (js) => {
  if (!webview) return Promise.resolve(null);
  return webview.executeJavaScript(js, true);
};

webview.addEventListener('ipc-message', (event) => {
  if (event.channel !== 'editorBridge') return;
  const payload = event.args?.[0];
  if (payload) window.equiShell.forwardBridge(payload);
});

webview.addEventListener('did-fail-load', (e) => {
  if (e.errorCode === -3) return;
  banner.hidden = false;
  banner.className = 'banner';
  banner.textContent = `页面加载失败：${e.errorDescription || e.errorCode}`;
});

webview.addEventListener('dom-ready', () => {
  try { webview.setAudioMuted(true); } catch (_) { /* ignore */ }
});

webview.setAttribute('preload', preloadSrc());
webview.setAttribute('src', editorSrc());
webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=no');

document.getElementById('toolbar').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  switch (action) {
    case 'new':
      await window.equiShell.newWindow();
      break;
    case 'open':
      await window.equiShell.open();
      break;
    case 'save':
      await window.equiShell.save();
      break;
    case 'undo':
    case 'redo':
    case 'focusSource':
    case 'focusWysiwyg':
    case 'zoomIn':
    case 'zoomOut':
    case 'zoomReset':
    case 'toggleOutline':
      window.equiShell.sendCommand(action);
      break;
    default:
      break;
  }
});

window.equiShell.onState(applyState);
window.equiShell.getState().then(applyState);
