/**
 * 编辑器内核入口：组装双栏、同步引擎、Bridge API。
 */

import './styles/editor.css';
import { createSourceEditor } from './editors/source-editor.js';
import { createWysiwygEditor } from './editors/wysiwyg-editor.js';
import { createSyncEngine } from './sync/sync-engine.js';
import { installSplitter } from './ui/splitter.js';
import { notifyReady, logToSwift, notifyLoadError } from './bridge.js';

function boot() {
  const sourceHost = document.getElementById('source-editor');
  const wysiwygHost = document.getElementById('wysiwyg-editor');
  const splitterEl = document.getElementById('splitter');
  const appEl = document.getElementById('app');
  const leftPane = document.getElementById('pane-source');

  if (!sourceHost || !wysiwygHost || !appEl) {
    throw new Error('DOM 节点缺失：需要 #app / #source-editor / #wysiwyg-editor');
  }

  /** 前向引用：sync 在 editors 之后创建 */
  const syncRef = { current: null };

  const source = createSourceEditor(sourceHost, {
    onChange: (md) => syncRef.current?.onSourceChange(md),
    onFocus: () => syncRef.current?.setFocus('source'),
    onBlur: () => {
      setTimeout(() => {
        if (!wysiwyg.editor.isFocused && !source.view.hasFocus) {
          syncRef.current?.setFocus('none');
        }
      }, 0);
    },
    onScroll: (ratio) => syncRef.current?.onSourceScroll(ratio),
  });

  const wysiwyg = createWysiwygEditor(wysiwygHost, {
    onChange: (getHtml) => syncRef.current?.onWysiwygChange(getHtml),
    onFocus: () => syncRef.current?.setFocus('wysiwyg'),
    onBlur: () => {
      setTimeout(() => {
        if (!wysiwyg.editor.isFocused && !source.view.hasFocus) {
          syncRef.current?.setFocus('none');
        }
      }, 0);
    },
    onScroll: (ratio) => syncRef.current?.onWysiwygScroll(ratio),
  });

  const sync = createSyncEngine({ source, wysiwyg });
  syncRef.current = sync;

  installSplitter({
    splitter: splitterEl,
    leftPane,
    container: appEl,
  });

  window.EditorAPI = {
    setMarkdown(payload) {
      if (typeof payload === 'string') {
        sync.setMarkdownFromNative({ markdown: payload, markClean: true });
        return;
      }
      sync.setMarkdownFromNative(payload ?? {});
    },
    getMarkdown() {
      return sync.getMarkdown();
    },
    undo() {
      const truth = sync.getSourceOfTruth();
      if (truth === 'wysiwyg') wysiwyg.undo();
      else source.undo();
    },
    redo() {
      const truth = sync.getSourceOfTruth();
      if (truth === 'wysiwyg') wysiwyg.redo();
      else source.redo();
    },
    focusPane(pane) {
      if (pane === 'wysiwyg' && !document.body.classList.contains('mode-plain')) {
        sync.setFocus('wysiwyg');
        wysiwyg.focus();
      } else {
        sync.setFocus('source');
        source.focus();
      }
    },
    markClean() {
      sync.markClean();
    },
    /**
     * 切换编辑模式。
     * @param {{ mode: 'markdown' | 'plain' }} payload
     */
    setEditingMode(payload) {
      const mode = typeof payload === 'string' ? payload : payload?.mode;
      const plain = mode === 'plain';
      document.body.classList.toggle('mode-plain', plain);
      const label = document.querySelector('#pane-source .pane-label');
      if (label) {
        label.textContent = plain ? '纯文本' : 'Markdown';
      }
      if (plain) {
        sync.setFocus('source');
        source.focus();
      }
      // 触发布局刷新，避免 CodeMirror 宽度停留在旧值
      requestAnimationFrame(() => {
        try {
          source.view.requestMeasure?.();
        } catch (_) {
          /* ignore */
        }
        window.dispatchEvent(new Event('resize'));
      });
    },
  };

  const welcome = `# Equi

左侧编辑 **原始 Markdown**，右侧进行所见即所得排版。

## 同步规则

- 焦点在左侧时：源码 → 富文本（单向）
- 焦点在右侧时：富文本 → 源码（单向）
- 拖拽中间分隔条可调整分栏宽度

\`\`\`js
console.log('离线 Bundle，无外网依赖');
\`\`\`

> 通过 Cmd+O / Cmd+S 由 macOS 原生层管理文件。
`;

  if (!window.webkit?.messageHandlers?.editorBridge) {
    sync.setMarkdownFromNative({ markdown: welcome, revision: 0, markClean: true });
  }

  notifyReady();
  logToSwift('Editor kernel booted');
  source.focus();
}

try {
  boot();
} catch (err) {
  console.error('[Equi] boot failed', err);
  const msg = err?.stack || err?.message || String(err);
  try {
    notifyLoadError(msg);
  } catch (_) {
    try {
      logToSwift('boot failed: ' + msg);
    } catch (__) {
      /* ignore */
    }
  }
  document.body.innerHTML =
    '<div style="padding:28px;font:13px -apple-system;line-height:1.5;color:#c0392b;background:#f6f5f2">' +
    '<h2 style="margin:0 0 8px">编辑器启动失败</h2>' +
    '<pre style="white-space:pre-wrap">' +
    String(msg) +
    '</pre></div>';
}
