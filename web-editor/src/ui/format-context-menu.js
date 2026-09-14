/**
 * 选区右键快捷菜单：字体样式 / 常用颜色 / 排版格式。
 * 主要用于 TipTap 所见即所得栏；也可挂到 CodeMirror 源码栏（Markdown 包裹）。
 */

/** @typedef {'wysiwyg' | 'source'} MenuTarget */

const TEXT_COLORS = [
  { id: 'default', label: '默认', value: null },
  { id: 'black', label: '黑色', value: 'black' },
  { id: 'gray', label: '灰色', value: 'gray' },
  { id: 'red', label: '红色', value: 'red' },
  { id: 'orange', label: '橙色', value: 'orange' },
  { id: 'green', label: '绿色', value: 'green' },
  { id: 'blue', label: '蓝色', value: 'blue' },
  { id: 'purple', label: '紫色', value: 'purple' },
];

const HIGHLIGHTS = [
  { id: 'none', label: '无底色', value: null },
  { id: 'yellow', label: '淡黄', value: '#fff3a3' },
  { id: 'mint', label: '薄荷', value: '#c8f0df' },
  { id: 'sky', label: '浅蓝', value: '#cfe8ff' },
  { id: 'peach', label: '桃粉', value: '#ffd6cc' },
];

/**
 * @param {{
 *   getWysiwyg: () => import('@tiptap/core').Editor | null,
 *   getSourceView: () => import('@codemirror/view').EditorView | null,
 *   onAfterFormat?: () => void,
 * }} options
 */
export function installFormatContextMenu({ getWysiwyg, getSourceView, onAfterFormat }) {
  const menu = document.createElement('div');
  menu.className = 'equi-ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = buildMenuHTML();
  document.body.appendChild(menu);

  /** @type {MenuTarget | null} */
  let activeTarget = null;
  let open = false;

  function hide() {
    if (!open) return;
    open = false;
    activeTarget = null;
    menu.hidden = true;
    menu.classList.remove('is-open');
  }

  /**
   * @param {MouseEvent} event
   * @param {MenuTarget} target
   */
  function showAt(event, target) {
    event.preventDefault();
    event.stopPropagation();
    activeTarget = target;
    refreshActiveStates();
    menu.hidden = false;
    menu.classList.add('is-open');
    open = true;

    const pad = 8;
    const { innerWidth: vw, innerHeight: vh } = window;
    const rect = menu.getBoundingClientRect();
    let left = event.clientX;
    let top = event.clientY;
    if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height + pad > vh) top = Math.max(pad, vh - rect.height - pad);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function refreshActiveStates() {
    const editor = getWysiwyg?.();
    const isWysiwyg = activeTarget === 'wysiwyg' && editor;

    menu.querySelectorAll('[data-cmd]').forEach((el) => {
      const cmd = el.getAttribute('data-cmd');
      let active = false;
      if (isWysiwyg && cmd) {
        active = isCommandActive(editor, cmd, el.getAttribute('data-value'));
      }
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    menu.querySelectorAll('[data-color]').forEach((el) => {
      const value = el.getAttribute('data-color');
      let active = false;
      if (isWysiwyg) {
        if (value === '') {
          active = !editor.getAttributes('textStyle').color;
        } else {
          active = editor.isActive('textStyle', { color: value });
        }
      }
      el.classList.toggle('is-active', active);
    });

    menu.querySelectorAll('[data-highlight]').forEach((el) => {
      const value = el.getAttribute('data-highlight');
      let active = false;
      if (isWysiwyg) {
        if (value === '') {
          active = !editor.isActive('highlight');
        } else {
          active = editor.isActive('highlight', { color: value });
        }
      }
      el.classList.toggle('is-active', active);
    });
  }

  menu.addEventListener('mousedown', (e) => {
    // 避免点菜单时让编辑器失焦丢选区
    e.preventDefault();
  });

  menu.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-cmd], [data-color], [data-highlight]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    if (btn.hasAttribute('data-color')) {
      applyColor(btn.getAttribute('data-color') || '');
    } else if (btn.hasAttribute('data-highlight')) {
      applyHighlight(btn.getAttribute('data-highlight') || '');
    } else {
      const cmd = btn.getAttribute('data-cmd');
      const value = btn.getAttribute('data-value');
      if (cmd) applyCommand(cmd, value);
    }
    hide();
    onAfterFormat?.();
  });

  function applyCommand(cmd, value) {
    if (activeTarget === 'wysiwyg') {
      applyWysiwygCommand(getWysiwyg?.(), cmd, value);
      return;
    }
    if (activeTarget === 'source') {
      applySourceCommand(getSourceView?.(), cmd, value);
    }
  }

  function applyColor(color) {
    if (activeTarget === 'wysiwyg') {
      const editor = getWysiwyg?.();
      if (!editor) return;
      const chain = editor.chain().focus();
      if (!color) chain.unsetColor().run();
      else chain.setColor(color).run();
      return;
    }
    if (activeTarget === 'source') {
      wrapSourceSelection(getSourceView?.(), (text) =>
        color
          ? `<span style="color: ${color}">${text}</span>`
          : text.replace(/^<span style="color:[^"]+">([\s\S]*)<\/span>$/i, '$1')
      );
    }
  }

  function applyHighlight(color) {
    if (activeTarget === 'wysiwyg') {
      const editor = getWysiwyg?.();
      if (!editor) return;
      const chain = editor.chain().focus();
      if (!color) chain.unsetHighlight().run();
      else chain.setHighlight({ color }).run();
      return;
    }
    if (activeTarget === 'source') {
      wrapSourceSelection(getSourceView?.(), (text) =>
        color
          ? `<mark style="background-color: ${color}">${text}</mark>`
          : text.replace(/^<mark(?:\s+style="[^"]*")?>([\s\S]*)<\/mark>$/i, '$1')
      );
    }
  }

  /** 挂到 WYSIWYG 宿主 */
  function attachWysiwyg(host) {
    if (!host) return () => {};
    const onCtx = (e) => {
      if (document.body.classList.contains('mode-plain')) return;
      showAt(e, 'wysiwyg');
    };
    host.addEventListener('contextmenu', onCtx);
    return () => host.removeEventListener('contextmenu', onCtx);
  }

  /** 挂到源码宿主 */
  function attachSource(host) {
    if (!host) return () => {};
    const onCtx = (e) => {
      const view = getSourceView?.();
      if (!view) return;
      const { from, to } = view.state.selection.main;
      // 无选区时仍可改段落级排版，但字体色更依赖选区；一律允许呼出
      showAt(e, 'source');
      void from;
      void to;
    };
    host.addEventListener('contextmenu', onCtx);
    return () => host.removeEventListener('contextmenu', onCtx);
  }

  const onDocPointer = (e) => {
    if (!open) return;
    if (e.target instanceof Node && menu.contains(e.target)) return;
    hide();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') hide();
  };
  const onScroll = () => hide();
  const onBlur = () => hide();

  document.addEventListener('pointerdown', onDocPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('scroll', onScroll, true);

  return {
    attachWysiwyg,
    attachSource,
    hide,
    destroy() {
      hide();
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll, true);
      menu.remove();
    },
  };
}

function buildMenuHTML() {
  const styleItems = [
    ['bold', '粗体', '⌘B'],
    ['italic', '斜体', '⌘I'],
    ['underline', '下划线', '⌘U'],
    ['strike', '删除线', ''],
    ['codeBlock', '代码块', ''],
  ]
    .map(
      ([cmd, label, hint]) =>
        `<button type="button" class="equi-ctx-item" role="menuitemcheckbox" data-cmd="${cmd}">` +
        `<span class="equi-ctx-label">${label}</span>` +
        (hint ? `<span class="equi-ctx-hint">${hint}</span>` : '') +
        `</button>`
    )
    .join('');

  const colorSwatches = TEXT_COLORS.map((c) => {
    const val = c.value ?? '';
    const style = c.value
      ? `style="--swatch:${c.value}"`
      : 'style="--swatch:var(--text)" data-default="1"';
    return `<button type="button" class="equi-ctx-swatch" data-color="${val}" title="${c.label}" aria-label="${c.label}" ${style}></button>`;
  }).join('');

  const highlightSwatches = HIGHLIGHTS.map((c) => {
    const val = c.value ?? '';
    const style = c.value
      ? `style="--swatch:${c.value}"`
      : 'style="--swatch:transparent" data-default="1"';
    return `<button type="button" class="equi-ctx-swatch equi-ctx-swatch-bg" data-highlight="${val}" title="${c.label}" aria-label="${c.label}" ${style}></button>`;
  }).join('');

  const layoutItems = [
    ['paragraph', '正文', null],
    ['heading', '标题 1', '1'],
    ['heading', '标题 2', '2'],
    ['heading', '标题 3', '3'],
    ['bulletList', '无序列表', null],
    ['orderedList', '有序列表', null],
    ['blockquote', '引用', null],
    ['clear', '清除格式', null],
  ]
    .map(([cmd, label, value]) => {
      const v = value != null ? ` data-value="${value}"` : '';
      return (
        `<button type="button" class="equi-ctx-item" role="menuitemcheckbox" data-cmd="${cmd}"${v}>` +
        `<span class="equi-ctx-label">${label}</span>` +
        `</button>`
      );
    })
    .join('');

  return `
    <div class="equi-ctx-section">字体样式</div>
    ${styleItems}
    <div class="equi-ctx-divider"></div>
    <div class="equi-ctx-section">文字颜色</div>
    <div class="equi-ctx-swatches" role="group" aria-label="文字颜色">${colorSwatches}</div>
    <div class="equi-ctx-section">底色高亮</div>
    <div class="equi-ctx-swatches" role="group" aria-label="底色高亮">${highlightSwatches}</div>
    <div class="equi-ctx-divider"></div>
    <div class="equi-ctx-section">排版格式</div>
    ${layoutItems}
  `;
}

function isCommandActive(editor, cmd, value) {
  switch (cmd) {
    case 'bold':
      return editor.isActive('bold');
    case 'italic':
      return editor.isActive('italic');
    case 'underline':
      return editor.isActive('underline');
    case 'strike':
      return editor.isActive('strike');
    case 'codeBlock':
      return editor.isActive('codeBlock');
    case 'paragraph':
      return editor.isActive('paragraph');
    case 'heading':
      return editor.isActive('heading', { level: Number(value) });
    case 'bulletList':
      return editor.isActive('bulletList');
    case 'orderedList':
      return editor.isActive('orderedList');
    case 'blockquote':
      return editor.isActive('blockquote');
    default:
      return false;
  }
}

function applyWysiwygCommand(editor, cmd, value) {
  if (!editor) return;
  const chain = editor.chain().focus();
  switch (cmd) {
    case 'bold':
      chain.toggleBold().run();
      break;
    case 'italic':
      chain.toggleItalic().run();
      break;
    case 'underline':
      chain.toggleUnderline().run();
      break;
    case 'strike':
      chain.toggleStrike().run();
      break;
    case 'codeBlock':
      chain.toggleCodeBlock().run();
      break;
    case 'paragraph':
      chain.setParagraph().run();
      break;
    case 'heading':
      chain.toggleHeading({ level: Number(value) || 1 }).run();
      break;
    case 'bulletList':
      chain.toggleBulletList().run();
      break;
    case 'orderedList':
      chain.toggleOrderedList().run();
      break;
    case 'blockquote':
      chain.toggleBlockquote().run();
      break;
    case 'clear':
      chain.unsetAllMarks().clearNodes().run();
      break;
    default:
      break;
  }
}

function applySourceCommand(view, cmd, value) {
  if (!view) return;
  switch (cmd) {
    case 'bold':
      wrapSourceSelection(view, (t) => `**${t}**`);
      break;
    case 'italic':
      wrapSourceSelection(view, (t) => `*${t}*`);
      break;
    case 'underline':
      wrapSourceSelection(view, (t) => `<u>${t}</u>`);
      break;
    case 'strike':
      wrapSourceSelection(view, (t) => `~~${t}~~`);
      break;
    case 'codeBlock':
      wrapSourceAsCodeFence(view);
      break;
    case 'heading': {
      const level = Number(value) || 1;
      prefixSourceLines(view, `${'#'.repeat(level)} `);
      break;
    }
    case 'paragraph':
      prefixSourceLines(view, '', { stripHeading: true });
      break;
    case 'bulletList':
      prefixSourceLines(view, '- ');
      break;
    case 'orderedList':
      prefixSourceLines(view, '1. ');
      break;
    case 'blockquote':
      prefixSourceLines(view, '> ');
      break;
    case 'clear':
      // 源码侧：去掉常见包裹标记
      wrapSourceSelection(view, (t) =>
        t
          .replace(/^(\*\*|__|\*|_|~~|`|<u>|<\/u>)+|(\*\*|__|\*|_|~~|`|<u>|<\/u>)+$/g, '')
          .replace(/^#+ /, '')
      );
      break;
    default:
      break;
  }
}

function wrapSourceSelection(view, wrapper) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const text = view.state.sliceDoc(from, to);
  const next = wrapper(text);
  view.dispatch({
    changes: { from, to, insert: next },
    selection: { anchor: from, head: from + next.length },
  });
  view.focus();
}

/** 将选区包成 Markdown 围栏代码块；无选区时插入空代码块并把光标放在中间。 */
function wrapSourceAsCodeFence(view, language = '') {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const selected = from === to ? '' : view.state.sliceDoc(from, to);
  const body = selected.length ? selected.replace(/\n$/, '') : '';
  const open = `\`\`\`${language}`;
  const close = '```';
  const insert = `${open}\n${body}\n${close}`;
  const cursor = from + open.length + 1 + body.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor, head: cursor },
  });
  view.focus();
}

function prefixSourceLines(view, prefix, { stripHeading = false } = {}) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to === from ? to : to - 1);
  const changes = [];
  let cursor = startLine.from;
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = view.state.doc.line(i);
    let text = line.text;
    if (stripHeading) {
      text = text.replace(/^#{1,6}\s+/, '');
      changes.push({ from: line.from, to: line.to, insert: text });
    } else if (prefix && !text.startsWith(prefix)) {
      changes.push({ from: line.from, insert: prefix });
    }
    cursor = line.to;
  }
  if (!changes.length) {
    view.focus();
    return;
  }
  view.dispatch({ changes });
  view.focus();
  void cursor;
}
