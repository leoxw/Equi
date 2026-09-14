/**
 * 行首缩进导引（原子内联节点）：
 * - 宽度 = level × 2em（约两个汉字宽）
 * - 用背景重复绘制竖直对齐线
 * - Markdown 中对应每级 2 个空格
 *
 * 优先级必须高于 TextStyle/Color：否则带 style 的 span 会被当成着色文本，
 * 只剩零宽字符，class/data 全部丢失，缩进宽度失效。
 */
import { Node, mergeAttributes } from '@tiptap/core';

function applyGuideDom(dom, level) {
  const n = Math.max(1, Math.min(32, level || 1));
  dom.className = 'equi-indent-guide';
  dom.setAttribute('data-equi-indent', String(n));
  // 不写 style 属性，避免再次被 TextStyle 解析；宽度靠 CSS [data-equi-indent] 规则
  dom.style.cssText = '';
  dom.style.setProperty('--equi-indent-level', String(n));
  dom.style.width = `${n * 2}em`;
  dom.style.minWidth = '2em';
  dom.style.display = 'inline-block';
  dom.textContent = '\u200b';
  return n;
}

export const IndentGuide = Node.create({
  name: 'indentGuide',
  // 高于 TextStyle(100)/Color，确保先匹配缩进导引
  priority: 1000,
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
      {
        tag: 'span.equi-indent-guide',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          const raw = el.getAttribute('data-equi-indent') || '1';
          const n = parseInt(raw, 10);
          return { level: Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 1 };
        },
      },
      {
        tag: 'span[data-equi-indent]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          // 排除普通着色 span：必须是导引节点（空/仅零宽字符）
          const text = (el.textContent || '').replace(/\u200b/g, '').trim();
          if (text.length > 0) return false;
          const raw = el.getAttribute('data-equi-indent') || '1';
          const n = parseInt(raw, 10);
          return { level: Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 1 };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level || 1;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'equi-indent-guide',
        'data-equi-indent': String(level),
      }),
      '\u200b',
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      applyGuideDom(dom, node.attrs.level || 1);
      return {
        dom,
        // atom 节点无 contentDOM
        update: (updated) => {
          if (updated.type.name !== 'indentGuide') return false;
          applyGuideDom(dom, updated.attrs.level || 1);
          return true;
        },
      };
    };
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
