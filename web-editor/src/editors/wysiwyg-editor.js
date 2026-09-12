/**
 * 右栏：TipTap（ProseMirror）所见即所得 Markdown 编辑器
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { EquiCodeBlock } from './equi-code-block.js';
import { BackspaceLiftIndent } from './backspace-lift-indent.js';
import { TabSoftIndent } from './tab-soft-indent.js';

export function createWysiwygEditor(parent, { onChange, onFocus, onBlur, onScroll }) {
  let suppressChange = false;

  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 使用带语言标签的 EquiCodeBlock
        heading: { levels: [1, 2, 3, 4] },
      }),
      EquiCodeBlock,
      BackspaceLiftIndent,
      TabSoftIndent,
      TextStyle,
      Color,
      Underline,
      Highlight.configure({ multicolor: true }),
      Table.configure({
        resizable: false,
        HTMLAttributes: { class: 'equi-table' },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener', target: null },
      }),
      Placeholder.configure({
        placeholder: '在此直接排版与编辑…',
      }),
    ],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'tiptap',
        spellcheck: 'true',
      },
      handleDOMEvents: {
        focus: () => {
          onFocus?.();
          return false;
        },
        blur: () => {
          onBlur?.();
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressChange) return;
      onChange?.(() => ed.getHTML());
    },
  });

  // TipTap 根节点滚动：监听可滚动父级 .editor-host
  const scrollHost = parent;
  const scrollHandler = () => {
    const max = scrollHost.scrollHeight - scrollHost.clientHeight;
    const ratio = max <= 0 ? 0 : scrollHost.scrollTop / max;
    onScroll?.(ratio);
  };
  scrollHost.addEventListener('scroll', scrollHandler, { passive: true });

  function getHtml() {
    return editor.getHTML();
  }

  /**
   * 静默灌入 HTML：保留选区（若有），不触发 onUpdate。
   */
  function setHtmlSilent(html) {
    const next = html || '<p></p>';
    if (editor.getHTML() === next) return;

    suppressChange = true;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(next, false);

    // 尝试恢复选区；越界时 ProseMirror 会夹紧。不强制 focus。
    try {
      const size = editor.state.doc.content.size;
      const a = Math.max(0, Math.min(from, size));
      const b = Math.max(0, Math.min(to, size));
      editor.commands.setTextSelection({ from: a, to: b });
    } catch {
      // ignore
    }

    requestAnimationFrame(() => {
      suppressChange = false;
    });
  }

  function getScrollRatio() {
    const max = scrollHost.scrollHeight - scrollHost.clientHeight;
    return max <= 0 ? 0 : scrollHost.scrollTop / max;
  }

  function setScrollRatio(ratio) {
    const max = scrollHost.scrollHeight - scrollHost.clientHeight;
    if (max <= 0) return;
    scrollHost.scrollTop = Math.max(0, Math.min(1, ratio)) * max;
  }

  return {
    editor,
    getHtml,
    setHtmlSilent,
    getScrollRatio,
    setScrollRatio,
    focus: () => editor.commands.focus('end'),
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
    destroy: () => {
      scrollHost.removeEventListener('scroll', scrollHandler);
      editor.destroy();
    },
  };
}
