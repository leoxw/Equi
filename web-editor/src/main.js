/**
 * 编辑器内核入口：组装双栏、同步引擎、Bridge API。
 */

import './styles/editor.css';
import { createSourceEditor } from './editors/source-editor.js';
import { createWysiwygEditor } from './editors/wysiwyg-editor.js';
import { createSyncEngine } from './sync/sync-engine.js';
import { installSplitter } from './ui/splitter.js';
import { notifyReady, logToSwift } from './bridge.js';

const sourceHost = document.getElementById('source-editor');
const wysiwygHost = document.getElementById('wysiwyg-editor');
const splitterEl = document.getElementById('splitter');
const appEl = document.getElementById('app');
const leftPane = document.getElementById('pane-source');

/** 前向引用：sync 在 editors 之后创建 */
const syncRef = { current: null };

const source = createSourceEditor(sourceHost, {
  onChange: (md) => syncRef.current?.onSourceChange(md),
  onFocus: () => syncRef.current?.setFocus('source'),
  onBlur: () => {
    // 若焦点转移到右栏，右栏 focus 会覆盖；否则置 none
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

/** Swift 可调用的全局 API */
window.EditorAPI = {
  setMarkdown(payload) {
    // payload 可能是对象，或（容错）纯字符串
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
    if (pane === 'wysiwyg') {
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
};

// 初始欢迎文稿（仅开发态；正式由 Swift setMarkdown 覆盖）
const welcome = `# Markdown Dual Editor

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
