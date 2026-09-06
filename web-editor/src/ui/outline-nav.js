/**
 * 左侧目录导航：从 TipTap 文档提取标题，点击跳转。
 */

/**
 * @param {{
 *   root: HTMLElement,
 *   getEditor: () => import('@tiptap/core').Editor | null,
 *   onNavigate?: (item: { level: number, text: string, pos: number }) => void,
 * }} options
 */
export function installOutlineNav({ root, getEditor, onNavigate }) {
  root.classList.add('outline-nav');
  root.innerHTML = `
    <div class="outline-nav-header">
      <span class="outline-nav-title">目录</span>
      <button type="button" class="outline-nav-toggle" title="折叠目录" aria-label="折叠目录">‹</button>
    </div>
    <div class="outline-nav-body" role="navigation" aria-label="文档目录"></div>
    <div class="outline-nav-empty">暂无标题</div>
  `;

  const body = root.querySelector('.outline-nav-body');
  const empty = root.querySelector('.outline-nav-empty');
  const toggle = root.querySelector('.outline-nav-toggle');
  let activePos = -1;
  let lastFingerprint = '';
  let raf = 0;

  toggle?.addEventListener('click', () => {
    document.body.classList.toggle('outline-collapsed');
    const collapsed = document.body.classList.contains('outline-collapsed');
    toggle.textContent = collapsed ? '›' : '‹';
    toggle.title = collapsed ? '展开目录' : '折叠目录';
    window.dispatchEvent(new Event('resize'));
  });

  function extractHeadings(editor) {
    if (!editor) return [];
    const items = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return;
      const level = Number(node.attrs.level) || 1;
      const text = (node.textContent || '').trim() || `标题 ${level}`;
      items.push({ level, text, pos });
    });
    return items;
  }

  function fingerprint(items) {
    return items.map((i) => `${i.level}:${i.pos}:${i.text}`).join('\n');
  }

  function render(items) {
    if (!body || !empty) return;
    const fp = fingerprint(items);
    if (fp === lastFingerprint) {
      highlightActive();
      return;
    }
    lastFingerprint = fp;
    body.innerHTML = '';
    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `outline-item outline-level-${Math.min(item.level, 4)}`;
      btn.dataset.pos = String(item.pos);
      btn.title = item.text;
      btn.innerHTML = `<span class="outline-item-text">${escapeHtml(item.text)}</span>`;
      btn.addEventListener('click', () => {
        navigateTo(item);
      });
      frag.appendChild(btn);
    }
    body.appendChild(frag);
    highlightActive();
  }

  function navigateTo(item) {
    const editor = getEditor?.();
    if (!editor) return;
    activePos = item.pos;
    highlightActive();
    try {
      editor.chain().focus().setTextSelection(item.pos + 1).run();
      const dom = editor.view.nodeDOM(item.pos);
      const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      // ignore
    }
    onNavigate?.(item);
  }

  function highlightActive() {
    if (!body) return;
    body.querySelectorAll('.outline-item').forEach((el) => {
      const pos = Number(el.dataset.pos);
      el.classList.toggle('is-active', pos === activePos);
    });
  }

  function refresh() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const editor = getEditor?.();
      render(extractHeadings(editor));
    });
  }

  /** 根据滚动位置高亮当前章节 */
  function syncActiveFromScroll(scrollHost) {
    const editor = getEditor?.();
    if (!editor || !scrollHost) return;
    const items = extractHeadings(editor);
    if (!items.length) return;
    const top = scrollHost.scrollTop + 24;
    let current = items[0];
    for (const item of items) {
      try {
        const coords = editor.view.coordsAtPos(item.pos + 1);
        const hostRect = scrollHost.getBoundingClientRect();
        const y = coords.top - hostRect.top + scrollHost.scrollTop;
        if (y <= top) current = item;
        else break;
      } catch {
        // ignore
      }
    }
    if (current && current.pos !== activePos) {
      activePos = current.pos;
      highlightActive();
    }
  }

  return {
    refresh,
    syncActiveFromScroll,
    destroy() {
      cancelAnimationFrame(raf);
      root.innerHTML = '';
    },
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
