/**
 * Tab 多级缩进：
 * - 列表内：sink/liftListItem
 * - 列表外：插入 / 调整 indentGuide（每级 = Markdown 两个空格 = 渲染 2em）
 */
import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

function findIndentGuideBefore($from) {
  const index = $from.index();
  if (index <= 0) return null;
  const node = $from.parent.child(index - 1);
  if (node?.type?.name === 'indentGuide') {
    return { node, offset: $from.pos - $from.parentOffset + $from.parent.offsetAt(index - 1) };
  }
  // 光标紧贴导引节点之后（parentOffset 指向导引后）
  if ($from.parentOffset > 0) {
    let pos = 0;
    for (let i = 0; i < $from.parent.childCount; i += 1) {
      const child = $from.parent.child(i);
      const start = $from.start() + pos;
      if (child.type.name === 'indentGuide' && $from.pos === start + child.nodeSize) {
        return { node: child, offset: start };
      }
      pos += child.nodeSize;
    }
  }
  return null;
}

function isAtVisualLineStart(state) {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent?.isTextblock) return false;
  if ($from.parentOffset === 0) return true;
  // hardBreak 之后也算一行开头
  const index = $from.index();
  if (index > 0 && $from.parent.child(index - 1).type.name === 'hardBreak') return true;
  // 紧跟 indentGuide（导引本身算行首装饰）
  if (index > 0 && $from.parent.child(index - 1).type.name === 'indentGuide') {
    // 若导引前是 hardBreak 或行首，允许继续加深
    if (index === 1) return true;
    return $from.parent.child(index - 2).type.name === 'hardBreak';
  }
  return false;
}

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

        const { state, view } = editor;
        if (!isAtVisualLineStart(state)) {
          // 非行首：插入两个空格，保持旧行为
          return editor.commands.insertContent('  ');
        }

        const found = findIndentGuideBefore(state.selection.$from);
        if (found) {
          const nextLevel = Math.min(32, (found.node.attrs.level || 1) + 1);
          const tr = state.tr.setNodeMarkup(found.offset, undefined, { level: nextLevel });
          view.dispatch(tr);
          return true;
        }

        return editor.commands.insertContent({
          type: 'indentGuide',
          attrs: { level: 1 },
        });
      },
      'Shift-Tab': () => {
        const editor = this.editor;
        if (editor.can().liftListItem('listItem')) {
          return editor.commands.liftListItem('listItem');
        }

        const { state, view } = editor;
        const { $from, empty } = state.selection;
        if (!empty || !$from.parent?.isTextblock) return false;

        const found = findIndentGuideBefore($from);
        if (found) {
          const level = found.node.attrs.level || 1;
          let tr = state.tr;
          if (level <= 1) {
            tr = tr.delete(found.offset, found.offset + found.node.nodeSize);
          } else {
            tr = tr.setNodeMarkup(found.offset, undefined, { level: level - 1 });
          }
          const nextPos = Math.min(tr.doc.content.size, Math.max(1, $from.pos - (level <= 1 ? 1 : 0)));
          try {
            tr = tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos)));
          } catch {
            // ignore
          }
          view.dispatch(tr);
          return true;
        }

        // 兼容旧的行首空格缩进
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
