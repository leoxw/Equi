/**
 * 左栏：CodeMirror 6 Markdown 源码编辑器
 */

import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from '@codemirror/language';

export function createSourceEditor(parent, { onChange, onFocus, onBlur, onScroll }) {
  let suppressChange = false;

  const changeListener = EditorView.updateListener.of((update) => {
    if (suppressChange) return;
    if (update.docChanged) {
      onChange?.(update.state.doc.toString());
    }
    if (update.focusChanged && update.view.hasFocus) {
      onFocus?.();
    }
  });

  const scrollDomHandler = (event) => {
    const scroller = event.target;
    if (!(scroller instanceof HTMLElement)) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const ratio = max <= 0 ? 0 : scroller.scrollTop / max;
    onScroll?.(ratio);
  };

  const state = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      history(),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      changeListener,
      EditorView.domEventHandlers({
        blur: () => {
          onBlur?.();
          return false;
        },
        focus: () => {
          onFocus?.();
          return false;
        },
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-content': { caretColor: 'var(--accent)' },
        '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      }),
    ],
  });

  const view = new EditorView({ state, parent });
  view.scrollDOM.addEventListener('scroll', scrollDomHandler, { passive: true });

  function getMarkdown() {
    return view.state.doc.toString();
  }

  /**
   * 静默写入：不触发 onChange。
   * 通过变更映射尽量保留选区，避免活跃侧光标跳动。
   * 非活跃侧被写入时通常无焦点，选区保留影响更小。
   */
  function setMarkdownSilent(markdownText) {
    const current = getMarkdown();
    const next = markdownText ?? '';
    if (current === next) return;

    suppressChange = true;
    const selection = view.state.selection;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next },
      selection,
    });
    requestAnimationFrame(() => {
      suppressChange = false;
    });
  }

  function getScrollRatio() {
    const scroller = view.scrollDOM;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return max <= 0 ? 0 : scroller.scrollTop / max;
  }

  function setScrollRatio(ratio) {
    const scroller = view.scrollDOM;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max <= 0) return;
    scroller.scrollTop = Math.max(0, Math.min(1, ratio)) * max;
  }

  return {
    view,
    getMarkdown,
    setMarkdownSilent,
    getScrollRatio,
    setScrollRatio,
    focus: () => view.focus(),
    undo: () => undo(view),
    redo: () => redo(view),
    destroy: () => {
      view.scrollDOM.removeEventListener('scroll', scrollDomHandler);
      view.destroy();
    },
  };
}
