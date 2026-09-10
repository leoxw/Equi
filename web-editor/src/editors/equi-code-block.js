/**
 * 带语言标签的代码块：在 TipTap CodeBlock 上增加语言选择与展示。
 */
import CodeBlock from '@tiptap/extension-code-block';

export const CODE_LANGUAGES = [
  { value: '', label: '纯文本' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'swift', label: 'Swift' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'xml', label: 'XML' },
  { value: 'toml', label: 'TOML' },
];

function languageLabel(value) {
  const found = CODE_LANGUAGES.find((item) => item.value === (value || ''));
  return found?.label || value || '纯文本';
}

export const EquiCodeBlock = CodeBlock.extend({
  name: 'codeBlock',

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
      if (lang) code.className = `language-${lang}`;
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
          code.className = nextLang ? `language-${nextLang}` : '';
          return true;
        },
      };
    };
  },
});
