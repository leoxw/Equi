/**
 * 带语言标签 + 语法高亮的代码块（TipTap CodeBlockLowlight + 自定义 NodeView）。
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { CODE_LANGUAGES, languageLabel, lowlight } from './code-highlight.js';

export { CODE_LANGUAGES, languageLabel, lowlight };

export const EquiCodeBlock = CodeBlockLowlight.extend({
  name: 'codeBlock',

  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
      defaultLanguage: null,
      languageClassPrefix: 'language-',
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;

      const dom = document.createElement('div');
      dom.className = 'equi-codeblock';
      dom.dataset.language = currentNode.attrs.language || '';

      const header = document.createElement('div');
      header.className = 'equi-codeblock-header';
      header.contentEditable = 'false';

      const badge = document.createElement('span');
      badge.className = 'equi-codeblock-badge';
      badge.textContent = languageLabel(currentNode.attrs.language);

      const select = document.createElement('select');
      select.className = 'equi-codeblock-lang';
      select.setAttribute('aria-label', '代码语言');
      select.title = '选择代码语言';
      for (const item of CODE_LANGUAGES) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        select.appendChild(option);
      }
      select.value = currentNode.attrs.language || '';

      const stop = (event) => event.stopPropagation();
      select.addEventListener('mousedown', stop);
      select.addEventListener('pointerdown', stop);
      select.addEventListener('click', stop);
      select.addEventListener('change', () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (typeof pos !== 'number') return;
        const language = select.value || null;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              language,
            });
            return true;
          })
          .run();
      });

      header.appendChild(badge);
      header.appendChild(select);

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      const lang = currentNode.attrs.language;
      if (lang) code.className = `language-${lang} hljs`;
      else code.className = 'hljs';
      pre.appendChild(code);

      dom.appendChild(header);
      dom.appendChild(pre);

      return {
        dom,
        contentDOM: code,
        update(updatedNode) {
          if (updatedNode.type.name !== 'codeBlock') return false;
          currentNode = updatedNode;
          const nextLang = updatedNode.attrs.language || '';
          dom.dataset.language = nextLang;
          badge.textContent = languageLabel(nextLang);
          if (select.value !== nextLang) select.value = nextLang;
          code.className = nextLang ? `language-${nextLang} hljs` : 'hljs';
          return true;
        },
      };
    };
  },
}).configure({
  lowlight,
  defaultLanguage: null,
});
