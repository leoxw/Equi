/**
 * Tab 多级缩进：
 * - 列表内：沿用 sink/liftListItem（多级嵌套）
 * - 列表外：插入 / 删除 2 个空格，不再依赖「4 空格变代码块」
 */
import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export const TabSoftIndent = Extension.create({
  name: 'tabSoftIndent',
  priority: 120,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const editor = this.editor;
        if (editor.can().sinkListItem('listItem')) {
          return editor.commands.sinkListItem('listItem');
        }
        return editor.commands.insertContent('  ');
      },
      'Shift-Tab': () => {
        const editor = this.editor;
        if (editor.can().liftListItem('listItem')) {
          return editor.commands.liftListItem('listItem');
        }

        const { state, view } = editor;
        const { $from, empty } = state.selection;
        if (!empty || !$from.parent?.isTextblock) return false;

        const text = $from.parent.textContent;
        const lead = text.match(/^ {1,2}/);
        if (!lead) return false;
        if ($from.parentOffset > lead[0].length) return false;

        const from = $from.start();
        const to = from + lead[0].length;
        const tr = state.tr.delete(from, to);
        const nextPos = Math.max(from, $from.pos - lead[0].length);
        tr.setSelection(TextSelection.create(tr.doc, nextPos));
        view.dispatch(tr);
        return true;
      },
    };
  },
});
