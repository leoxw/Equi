/**
 * 双向实时同步引擎（核心难点）
 *
 * sourceOfTruth 状态锁：
 *  - 'source'  : 焦点在左栏 → 左→右单向；右栏更新被锁，不回写
 *  - 'wysiwyg' : 焦点在右栏 → 右→左单向；左栏更新被锁，不回写
 *  - 'none'    : 无焦点 / 外部注入 → 允许双向静默灌入
 *
 * 防抖 + 内容指纹去重，避免死循环与卡顿。
 * 滚动百分比视口同步；活跃侧光标/选区由各编辑器自行保护（静默 set 不抢焦点）。
 */

import { markdownToHtml, htmlToMarkdown, countStats } from './markdown-io.js';
import { notifyContentChange } from '../bridge.js';

const DEBOUNCE_MS = 120;
const SCROLL_SYNC_EPS = 0.002;

export function createSyncEngine({ source, wysiwyg }) {
  /** @type {'source'|'wysiwyg'|'none'} */
  let sourceOfTruth = 'none';
  let syncLock = false;
  let dirty = false;
  let baselineMarkdown = '';
  let lastMarkdown = '';
  let lastRevision = 0;

  let sourceTimer = null;
  let wysiwygTimer = null;
  let scrollLock = false;

  function setFocus(pane) {
    sourceOfTruth = pane === 'source' || pane === 'wysiwyg' ? pane : 'none';
  }

  function fingerprint(md) {
    return md ?? '';
  }

  function emitToSwift(markdown) {
    const stats = countStats(markdown);
    dirty = markdown !== baselineMarkdown;
    lastMarkdown = markdown;
    notifyContentChange({
      markdown,
      dirty,
      wordCount: stats.wordCount,
      characterCount: stats.characterCount,
    });
  }

  // —— 左 → 右 ——
  function onSourceChange(markdown, { immediate = false } = {}) {
    if (syncLock) return;
    if (sourceOfTruth === 'wysiwyg') return; // 右栏为真相源时忽略左栏回声

    const run = () => {
      const md = typeof markdown === 'function' ? markdown() : markdown;
      if (fingerprint(md) === fingerprint(lastMarkdown) && !immediate) {
        // 仍可能需要上报 dirty（例如撤销到基线）
        emitToSwift(md);
        return;
      }
      syncLock = true;
      try {
        const html = markdownToHtml(md);
        wysiwyg.setHtmlSilent(html);
        emitToSwift(md);
      } finally {
        // 下一帧解锁，避开 TipTap 同步事务回声
        requestAnimationFrame(() => {
          syncLock = false;
        });
      }
    };

    clearTimeout(sourceTimer);
    if (immediate) run();
    else sourceTimer = setTimeout(run, DEBOUNCE_MS);
  }

  // —— 右 → 左 ——
  function onWysiwygChange(getHtml, { immediate = false } = {}) {
    if (syncLock) return;
    if (sourceOfTruth === 'source') return;

    const run = () => {
      const html = typeof getHtml === 'function' ? getHtml() : getHtml;
      const md = htmlToMarkdown(html);
      if (fingerprint(md) === fingerprint(lastMarkdown) && !immediate) {
        emitToSwift(md);
        return;
      }
      syncLock = true;
      try {
        source.setMarkdownSilent(md);
        emitToSwift(md);
      } finally {
        requestAnimationFrame(() => {
          syncLock = false;
        });
      }
    };

    clearTimeout(wysiwygTimer);
    if (immediate) run();
    else wysiwygTimer = setTimeout(run, DEBOUNCE_MS);
  }

  // —— 外部（Swift）注入 ——
  function setMarkdownFromNative({ markdown, revision, markClean }) {
    const md = markdown ?? '';
    if (revision != null && revision === lastRevision && fingerprint(md) === fingerprint(lastMarkdown)) {
      return;
    }
    lastRevision = revision ?? lastRevision;
    syncLock = true;
    sourceOfTruth = 'none';
    try {
      source.setMarkdownSilent(md);
      wysiwyg.setHtmlSilent(markdownToHtml(md));
      lastMarkdown = md;
      if (markClean) baselineMarkdown = md;
      dirty = markClean ? false : md !== baselineMarkdown;
      emitToSwift(md);
    } finally {
      requestAnimationFrame(() => {
        syncLock = false;
      });
    }
  }

  function markClean(markdown) {
    baselineMarkdown = markdown ?? lastMarkdown;
    dirty = false;
    emitToSwift(lastMarkdown);
  }

  // —— 滚动百分比同步 ——
  function syncScroll(from, ratio) {
    if (scrollLock) return;
    if (!Number.isFinite(ratio)) return;
    scrollLock = true;
    try {
      if (from === 'source') wysiwyg.setScrollRatio(ratio);
      else source.setScrollRatio(ratio);
    } finally {
      // 用 rAF 双缓冲，避免互踢
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollLock = false;
        });
      });
    }
  }

  function onSourceScroll(ratio) {
    if (Math.abs((wysiwyg.getScrollRatio?.() ?? 0) - ratio) < SCROLL_SYNC_EPS) return;
    syncScroll('source', ratio);
  }

  function onWysiwygScroll(ratio) {
    if (Math.abs((source.getScrollRatio?.() ?? 0) - ratio) < SCROLL_SYNC_EPS) return;
    syncScroll('wysiwyg', ratio);
  }

  return {
    setFocus,
    onSourceChange,
    onWysiwygChange,
    setMarkdownFromNative,
    markClean,
    onSourceScroll,
    onWysiwygScroll,
    getMarkdown: () => lastMarkdown,
    isDirty: () => dirty,
    getSourceOfTruth: () => sourceOfTruth,
  };
}
