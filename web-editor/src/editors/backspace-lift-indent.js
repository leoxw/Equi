/**
 * 渲染窗 Backspace：删空本行后，先逐级取消缩进，再退到上一行。
 *
 * 顺序：
 * 0. 光标紧跟 indentGuide → 降一级或删除导引
 * 1. 嵌套列表 → liftListItem（每次一级）
 * 2. 最外层空列表项 → lift 退出列表，变成普通段落
 * 3. 引用块 → lift 脱出一层
 * 4. 已无缩进 → 返回 false，交给默认 joinBackward 并入上一行
 */
import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

function isEmptyTextblockAtStart(state) {
  const { empty, $from } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;
  const parent = $from.parent;
  if (!parent?.isTextblock) return false;
  return parent.content.size === 0;
}

function findAncestorName($from, names) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth)?.type?.name;
    if (names.includes(name)) return name;
  }
  return null;
}

/** 若光标紧跟在 indentGuide 之后，返回该节点位置 */
function findIndentGuideBefore($from) {
  const index = $from.index();
  if (index <= 0) return null;
  const node = $from.parent.child(index - 1);
  if (node?.type?.name !== 'indentGuide') return null;
  const offset = $from.start() + $from.parent.offsetAt(index - 1);
  return { node, offset };
}

export const BackspaceLiftIndent = Extension.create({
  name: 'backspaceLiftIndent',
  // 高于默认 keymap(100)，以便抢先处理空行缩进
  priority: 120,

  addKeyboardShortcuts() {
    const handleBackspace = () => {
      const editor = this.editor;
      const { state, view } = editor;
      const { $from, empty } = state.selection;

      // 行首缩进导引：先降级 / 删除导引
      if (empty && $from.parent?.isTextblock) {
        const found = findIndentGuideBefore($from);
        if (found) {
          const level = found.node.attrs.level || 1;
          let tr = state.tr;
          if (level <= 1) {
            tr = tr.delete(found.offset, found.offset + found.node.nodeSize);
          } else {
            tr = tr.setNodeMarkup(found.offset, undefined, { level: level - 1 });
          }
          try {
            const nextPos = Math.min(
              tr.doc.content.size,
              Math.max(1, $from.pos - (level <= 1 ? found.node.nodeSize : 0)),
            );
            tr = tr.setSelection(TextSelection.near(tr.doc.resolve(nextPos)));
          } catch {
            // ignore
          }
          view.dispatch(tr);
          return true;
        }
      }

      if (!isEmptyTextblockAtStart(state)) return false;

      const ancestor = findAncestorName($from, ['listItem', 'blockquote']);

      if (ancestor === 'listItem') {
        // 嵌套列表：逐级减少缩进
        if (editor.can().liftListItem('listItem')) {
          return editor.commands.liftListItem('listItem');
        }
        // 最外层空列表项：先退出列表，仍保留本行空段落
        if (editor.can().lift()) {
          return editor.commands.lift();
        }
      }

      if (ancestor === 'blockquote' && editor.can().lift()) {
        return editor.commands.lift();
      }

      // 已无缩进：默认逻辑退到上一行
      return false;
    };

    return {
      Backspace: handleBackspace,
      'Mod-Backspace': handleBackspace,
      'Shift-Backspace': handleBackspace,
    };
  },
});
