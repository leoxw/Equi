/**
 * 编辑器内核入口：组装目录、双栏、同步引擎、缩放与 Bridge API。
 */

import './styles/editor.css';
import { createSourceEditor } from './editors/source-editor.js';
import { createWysiwygEditor } from './editors/wysiwyg-editor.js';
import { createSyncEngine } from './sync/sync-engine.js';
import { installSplitter } from './ui/splitter.js';
import { installFormatContextMenu } from './ui/format-context-menu.js';
import { installOutlineNav } from './ui/outline-nav.js';
import { installPreviewZoom } from './ui/preview-zoom.js';
import { createPaneVisibility } from './ui/pane-visibility.js';
import { notifyReady, logToSwift, notifyLoadError } from './bridge.js';
import { installImageInsert, buildMarkdownImage, completeImportMedia as resolveImportMedia } from './media/image-insert.js';
import { setDocumentContext as applyDocumentContext } from './media/document-context.js';

function boot() {
  const sourceHost = document.getElementById('source-editor');
  const wysiwygHost = document.getElementById('wysiwyg-editor');
  const splitterEl = document.getElementById('splitter');
  const appEl = document.getElementById('app');
  const leftPane = document.getElementById('pane-source');
  const outlineHost = document.getElementById('outline-nav');

  if (!sourceHost || !wysiwygHost || !appEl) {
    throw new Error('DOM 节点缺失：需要 #app / #source-editor / #wysiwyg-editor');
  }

  /** 前向引用：sync 在 editors 之后创建 */
  const syncRef = { current: null };
  let outline = null;

  const source = createSourceEditor(sourceHost, {
    onChange: (md) => {
      syncRef.current?.onSourceChange(md);
      outline?.refresh();
    },
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
    onChange: (getHtml) => {
      syncRef.current?.onWysiwygChange(getHtml);
      outline?.refresh();
    },
    onFocus: () => syncRef.current?.setFocus('wysiwyg'),
    onBlur: () => {
      setTimeout(() => {
        if (!wysiwyg.editor.isFocused && !source.view.hasFocus) {
          syncRef.current?.setFocus('none');
        }
      }, 0);
    },
    onScroll: (ratio) => {
      syncRef.current?.onWysiwygScroll(ratio);
      outline?.syncActiveFromScroll(wysiwygHost);
    },
  });

  const sync = createSyncEngine({ source, wysiwyg });
  syncRef.current = sync;

  installSplitter({
    splitter: splitterEl,
    leftPane,
    container: appEl,
  });

  const formatMenu = installFormatContextMenu({
    getWysiwyg: () => wysiwyg.editor,
    getSourceView: () => source.view,
  });
  formatMenu.attachWysiwyg(wysiwygHost);
  formatMenu.attachSource(sourceHost);

  if (outlineHost) {
    outline = installOutlineNav({
      root: outlineHost,
      getEditor: () => wysiwyg.editor,
      onNavigate: (item) => {
        sync.setFocus('wysiwyg');
        // 同步左侧源码跳到对应标题，便于对照编辑
        try {
          source.revealHeading?.({ level: item.level, text: item.text });
        } catch {
          // ignore
        }
      },
    });
  }

  const zoom = installPreviewZoom({
    target: wysiwygHost,
    labelEl: document.getElementById('zoom-reset'),
    minusBtn: document.getElementById('zoom-out'),
    plusBtn: document.getElementById('zoom-in'),
    resetBtn: document.getElementById('zoom-reset'),
  });

  const panes = createPaneVisibility();
  panes.bind();

  // TipTap 事务后刷新目录（覆盖程序化 setContent）
  wysiwyg.editor.on('update', () => outline?.refresh());
  wysiwyg.editor.on('selectionUpdate', () => {
    try {
      const { $from } = wysiwyg.editor.state.selection;
      for (let d = $from.depth; d > 0; d -= 1) {
        const node = $from.node(d);
        if (node.type.name === 'heading') {
          outline?.refresh();
          break;
        }
      }
    } catch {
      // ignore
    }
  });

  window.EditorAPI = {
    setMarkdown(payload) {
      if (typeof payload === 'string') {
        sync.setMarkdownFromNative({ markdown: payload, markClean: true });
      } else {
        sync.setMarkdownFromNative(payload ?? {});
      }
      outline?.refresh();
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
        panes.ensureVisible('wysiwyg');
        sync.setFocus('wysiwyg');
        wysiwyg.focus();
      } else {
        panes.ensureVisible('source');
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
      panes.resetForPlainMode(plain);
      const label = document.querySelector('#pane-source .pane-label');
      if (label) {
        // Markdown / 纯文本模式下左侧栏统一显示「纯文本」
        label.textContent = '纯文本';
      }
      const previewLabel = document.querySelector('#pane-wysiwyg .pane-label');
      if (previewLabel) {
        previewLabel.textContent = 'markdown渲染后';
      }
      if (plain) {
        sync.setFocus('source');
        source.focus();
      } else {
        outline?.refresh();
      }
      requestAnimationFrame(() => {
        try {
          source.view.requestMeasure?.();
        } catch (_) {
          /* ignore */
        }
        window.dispatchEvent(new Event('resize'));
      });
    },
    /** 预览缩放：0.7–2.0，或 'in' | 'out' | 'reset' */
    setPreviewZoom(payload) {
      if (payload === 'in' || payload?.action === 'in') {
        zoom.zoomIn();
        return zoom.getZoom();
      }
      if (payload === 'out' || payload?.action === 'out') {
        zoom.zoomOut();
        return zoom.getZoom();
      }
      if (payload === 'reset' || payload?.action === 'reset') {
        zoom.reset();
        return zoom.getZoom();
      }
      const value = typeof payload === 'number' ? payload : payload?.zoom;
      if (value != null) zoom.setZoom(value);
      return zoom.getZoom();
    },
    getPreviewZoom() {
      return zoom.getZoom();
    },
    toggleOutline(payload) {
      const force = typeof payload === 'boolean' ? payload : payload?.collapsed;
      const next =
        typeof force === 'boolean'
          ? force
          : !document.body.classList.contains('outline-collapsed');
      if (outline?.setCollapsed) {
        outline.setCollapsed(next);
      } else {
        document.body.classList.toggle('outline-collapsed', next);
        window.dispatchEvent(new Event('resize'));
      }
      return { collapsed: document.body.classList.contains('outline-collapsed') };
    },
    toggleSourcePane(payload) {
      const force = typeof payload === 'boolean' ? payload : payload?.collapsed;
      return panes.toggleSource(force);
    },
    togglePreviewPane(payload) {
      const force = typeof payload === 'boolean' ? payload : payload?.collapsed;
      return panes.togglePreview(force);
    },
    /**
     * 插入图片。payload: { src, markdownSrc?, alt? }
     * - src：预览用（可为 file:// 绝对路径）
     * - markdownSrc：写入 Markdown 的相对路径（如 Notesmedia/a.png）；缺省则用 src
     */
    insertImage(payload = {}) {
      const src = typeof payload === 'string' ? payload : payload?.src;
      const markdownSrc =
        typeof payload === 'string' ? payload : (payload?.markdownSrc || payload?.src);
      const alt = typeof payload === 'string' ? 'image' : (payload?.alt || 'image');
      if (!src && !markdownSrc) return false;
      const truth = sync.getSourceOfTruth();
      if (truth === 'wysiwyg' || (truth === 'none' && wysiwyg.editor?.isFocused)) {
        const ok = wysiwyg.insertImage({ src: src || markdownSrc, alt });
        if (ok) outline?.refresh();
        return !!ok;
      }
      const md = buildMarkdownImage({ src: markdownSrc || src, alt });
      const snippet = `\n${md}\n`;
      const ok = source.insertAtCursor(snippet);
      if (ok) {
        sync.onSourceChange(source.getMarkdown(), { immediate: true });
        outline?.refresh();
      }
      return !!ok;
    },
    /** 原生下发文稿目录，用于解析相对媒体路径 */
    setDocumentContext(payload = {}) {
      applyDocumentContext(payload);
      // 已有内容时按新基路径重解析预览
      try {
        const md = sync.getMarkdown();
        if (md) sync.setMarkdownFromNative({ markdown: md, markClean: !sync.isDirty?.() });
      } catch (_) {
        /* ignore */
      }
      return true;
    },
    /** 原生导入媒体完成回调 */
    completeImportMedia(payload = {}) {
      resolveImportMedia(payload);
      return true;
    },
  };

  const welcome = `# MarkDuo

左侧编辑 **原始 Markdown**，右侧预览排版对齐 Cursor 打开 Markdown 的阅读样式。

## 目录与缩放

- 最左侧为标题目录，点击可跳转
- 右上角 \`-\` / \`%\` / \`+\` 可缩放预览字号

## 同步规则

- 焦点在左侧时：源码 → 富文本（单向）
- 焦点在右侧时：富文本 → 源码（单向）

\`\`\`js
console.log('离线 Bundle，无外网依赖');
\`\`\`

> 通过 Cmd+O / Cmd+S 由 macOS 原生层管理文件。
`;

  if (!window.webkit?.messageHandlers?.editorBridge) {
    sync.setMarkdownFromNative({ markdown: welcome, revision: 0, markClean: true });
  }

  installImageInsert({
    insertImage: (payload) => window.EditorAPI.insertImage(payload),
  });

  outline?.refresh();
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
