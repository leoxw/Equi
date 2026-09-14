/**
 * 左侧文件浏览器：列出文稿同目录（及浏览中的目录）下的文件夹与可打开文件。
 * 目录列举 / 打开由原生桥完成（沙盒无法在 Web 内直接读盘）。
 */

import { postToSwift, hasNativeBridge } from '../bridge.js';
import { getDocumentContext } from '../media/document-context.js';

const COLLAPSE_KEY = 'equi.outlineCollapsed';

const pendingLists = new Map();
let listSeq = 0;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function requestListDirectory(path) {
  const requestId = `listdir-${Date.now()}-${++listSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingLists.delete(requestId);
      reject(new Error('列举目录超时'));
    }, 15000);
    pendingLists.set(requestId, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    const payload = { type: 'listDirectory', requestId };
    if (path) payload.path = path;
    if (!postToSwift(payload)) {
      pendingLists.delete(requestId);
      clearTimeout(timer);
      reject(new Error('原生桥不可用'));
    }
  });
}

/** 原生回调：window.EditorAPI.completeListDirectory */
export function completeListDirectory(payload = {}) {
  const pending = pendingLists.get(payload.requestId);
  if (!pending) return;
  pendingLists.delete(payload.requestId);
  if (payload.ok) {
    pending.resolve(payload);
  } else {
    pending.reject(new Error(payload.error || '列举目录失败'));
  }
}

/**
 * @param {{ root: HTMLElement }} options
 */
export function installFileBrowser({ root }) {
  root.classList.add('outline-nav', 'file-browser');
  root.innerHTML = `
    <div class="outline-nav-header file-browser-header">
      <button type="button" class="file-browser-up" title="返回上一级" aria-label="返回上一级" disabled>↑</button>
      <span class="outline-nav-title file-browser-title" title="">文件</span>
      <button type="button" class="outline-nav-toggle" title="折叠文件列表" aria-label="折叠文件列表">‹</button>
    </div>
    <div class="file-browser-path" title=""></div>
    <div class="outline-nav-body file-browser-body" role="navigation" aria-label="文件列表"></div>
    <div class="outline-nav-empty file-browser-empty">请先打开或保存文稿</div>
  `;

  const body = root.querySelector('.file-browser-body');
  const empty = root.querySelector('.file-browser-empty');
  const toggle = root.querySelector('.outline-nav-toggle');
  const upBtn = root.querySelector('.file-browser-up');
  const pathEl = root.querySelector('.file-browser-path');
  const titleEl = root.querySelector('.file-browser-title');

  let browsingPath = null;
  let parentPath = null;
  let currentFileName = null;
  let lastFingerprint = '';
  let refreshToken = 0;

  function setCollapsed(collapsed) {
    document.body.classList.toggle('outline-collapsed', collapsed);
    if (toggle) {
      toggle.textContent = collapsed ? '›' : '‹';
      toggle.title = collapsed ? '展开文件列表' : '折叠文件列表';
    }
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('resize'));
  }

  try {
    if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
  } catch {
    /* ignore */
  }

  toggle?.addEventListener('click', () => {
    setCollapsed(!document.body.classList.contains('outline-collapsed'));
  });

  upBtn?.addEventListener('click', () => {
    if (!parentPath) return;
    browsingPath = parentPath;
    refresh();
  });

  function showEmpty(message) {
    if (body) body.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.textContent = message || '请先打开或保存文稿';
    }
    if (upBtn) upBtn.disabled = true;
    if (pathEl) {
      pathEl.textContent = '';
      pathEl.title = '';
    }
    lastFingerprint = '';
  }

  function folderLabel(path) {
    const s = String(path || '').replace(/[/\\]+$/, '');
    const parts = s.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || s || '文件';
  }

  function render(payload) {
    browsingPath = payload.path || browsingPath;
    parentPath = payload.parentPath || null;
    currentFileName = payload.currentFileName || getDocumentContext().fileName || null;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    if (upBtn) upBtn.disabled = !parentPath;
    if (titleEl) {
      const label = folderLabel(browsingPath);
      titleEl.textContent = label;
      titleEl.title = browsingPath || label;
    }
    if (pathEl) {
      pathEl.textContent = browsingPath || '';
      pathEl.title = browsingPath || '';
    }

    const fp = JSON.stringify({
      path: browsingPath,
      file: currentFileName,
      entries: entries.map((e) => `${e.kind}:${e.name}`),
    });
    if (fp === lastFingerprint) return;
    lastFingerprint = fp;

    if (!body || !empty) return;
    body.innerHTML = '';
    if (!entries.length) {
      empty.hidden = false;
      empty.textContent = '此文件夹为空';
      return;
    }
    empty.hidden = true;

    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isDir = entry.kind === 'dir';
      const isActive = !isDir && entry.name === currentFileName;
      btn.className = `outline-item file-browser-item ${isDir ? 'is-dir' : 'is-file'}${isActive ? ' is-active' : ''}`;
      btn.title = entry.path || entry.name;
      btn.dataset.path = entry.path || '';
      btn.dataset.kind = entry.kind || 'file';
      const icon = isDir ? '▸' : '·';
      btn.innerHTML = `<span class="file-browser-icon" aria-hidden="true">${icon}</span><span class="outline-item-text">${escapeHtml(entry.name)}</span>`;
      btn.addEventListener('click', () => {
        if (isDir) {
          browsingPath = entry.path;
          refresh();
        } else if (entry.path) {
          openPath(entry.path);
        }
      });
      frag.appendChild(btn);
    }
    body.appendChild(frag);
  }

  function openPath(path) {
    if (!path) return;
    postToSwift({ type: 'openPath', path });
  }

  async function refresh(options = {}) {
    const token = ++refreshToken;
    if (!hasNativeBridge()) {
      showEmpty('浏览器开发态无文件系统');
      return;
    }
    const ctx = getDocumentContext();
    if (!browsingPath && !ctx.directoryURL && !options.path) {
      showEmpty('请先打开或保存文稿');
      return;
    }
    try {
      const pathArg = options.path || browsingPath || null;
      const payload = await requestListDirectory(pathArg);
      if (token !== refreshToken) return;
      render(payload);
    } catch (err) {
      if (token !== refreshToken) return;
      showEmpty(err?.message || '无法读取文件夹');
    }
  }

  /** 文稿目录变化时重置浏览位置并刷新 */
  function onDocumentContextChanged() {
    browsingPath = null;
    parentPath = null;
    currentFileName = getDocumentContext().fileName || null;
    refresh();
  }

  return {
    refresh,
    onDocumentContextChanged,
    setCollapsed,
    getCollapsed: () => document.body.classList.contains('outline-collapsed'),
  };
}
