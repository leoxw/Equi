/**
 * Markdown 双栏显隐：纯文本栏 / markdown渲染后 栏均可折叠为窄条。
 */
export function createPaneVisibility() {
  const body = document.body;

  function isSourceCollapsed() {
    return body.classList.contains('source-collapsed');
  }

  function isPreviewCollapsed() {
    return body.classList.contains('preview-collapsed');
  }

  function syncButtons() {
    const sourceBtn = document.getElementById('toggle-source-pane');
    const previewBtn = document.getElementById('toggle-preview-pane');
    if (sourceBtn) {
      const collapsed = isSourceCollapsed();
      sourceBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      sourceBtn.title = collapsed ? '显示纯文本' : '隐藏纯文本';
      sourceBtn.textContent = collapsed ? '▸' : '◂';
    }
    if (previewBtn) {
      const collapsed = isPreviewCollapsed();
      previewBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      previewBtn.title = collapsed ? '显示 markdown渲染后' : '隐藏 markdown渲染后';
      previewBtn.textContent = collapsed ? '◂' : '▸';
    }
  }

  function setSourceCollapsed(collapsed) {
    if (body.classList.contains('mode-plain')) {
      body.classList.remove('source-collapsed');
      syncButtons();
      return snapshot();
    }
    body.classList.toggle('source-collapsed', !!collapsed);
    syncButtons();
    window.dispatchEvent(new Event('resize'));
    return snapshot();
  }

  function setPreviewCollapsed(collapsed) {
    if (body.classList.contains('mode-plain')) {
      body.classList.remove('preview-collapsed');
      syncButtons();
      return snapshot();
    }
    body.classList.toggle('preview-collapsed', !!collapsed);
    syncButtons();
    window.dispatchEvent(new Event('resize'));
    return snapshot();
  }

  function snapshot() {
    return {
      sourceCollapsed: isSourceCollapsed(),
      previewCollapsed: isPreviewCollapsed(),
    };
  }

  function toggleSource(force) {
    const next = typeof force === 'boolean' ? force : !isSourceCollapsed();
    return setSourceCollapsed(next);
  }

  function togglePreview(force) {
    const next = typeof force === 'boolean' ? force : !isPreviewCollapsed();
    return setPreviewCollapsed(next);
  }

  function ensureVisible(pane) {
    if (pane === 'source' && isSourceCollapsed()) setSourceCollapsed(false);
    if (pane === 'wysiwyg' && isPreviewCollapsed()) setPreviewCollapsed(false);
  }

  function resetForPlainMode(plain) {
    if (plain) {
      body.classList.remove('source-collapsed', 'preview-collapsed');
    }
    syncButtons();
  }

  function bind() {
    document
      .getElementById('toggle-source-pane')
      ?.addEventListener('click', () => toggleSource());
    document
      .getElementById('toggle-preview-pane')
      ?.addEventListener('click', () => togglePreview());
    syncButtons();
  }

  return {
    bind,
    toggleSource,
    togglePreview,
    setSourceCollapsed,
    setPreviewCollapsed,
    ensureVisible,
    resetForPlainMode,
    isSourceCollapsed,
    isPreviewCollapsed,
    snapshot,
  };
}
