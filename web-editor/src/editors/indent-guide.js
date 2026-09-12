/**
 * 行首缩进导引（原子内联节点）：
 * - 宽度 = level × 2em（约两个汉字宽）
 * - 用背景重复绘制竖直对齐线
 * - Markdown 中对应每级 2 个空格
 */
import { Node, mergeAttributes } from '@tiptap/core';

export const IndentGuide = Node.create({
  name: 'indentGuide',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-equi-indent') || '1';
          const n = parseInt(raw, 10);
          return Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 1;
        },
        renderHTML: (attributes) => ({
          'data-equi-indent': String(attributes.level || 1),
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span.equi-indent-guide' },
      { tag: 'span[data-equi-indent]' },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level || 1;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'equi-indent-guide',
        'data-equi-indent': String(level),
        style: `--equi-indent-level: ${level}`,
        contenteditable: 'false',
      }),
      // 零宽字符：turndown 会跳过完全空的 span，回写 Markdown 会丢缩进
      '\u200b',
    ];
  },

  addCommands() {
    return {
      setIndentGuide:
        (level = 1) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { level: Math.max(1, Math.min(32, level | 0)) },
          }),
    };
  },
});
