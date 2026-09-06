/**
 * Markdown 渲染区缩放（字号倍率，保留排版回流）。
 */

const MIN = 0.7;
const MAX = 2;
const STEP = 0.1;
const STORAGE_KEY = 'equi.previewZoom';

/**
 * @param {{
 *   target: HTMLElement,
 *   labelEl?: HTMLElement | null,
 *   minusBtn?: HTMLElement | null,
 *   plusBtn?: HTMLElement | null,
 *   resetBtn?: HTMLElement | null,
 *   onChange?: (zoom: number) => void,
 * }} options
 */
export function installPreviewZoom({
  target,
  labelEl,
  minusBtn,
  plusBtn,
  resetBtn,
  onChange,
}) {
  let zoom = 1;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN && stored <= MAX) zoom = stored;
  } catch {
    // ignore
  }

  function apply() {
    zoom = Math.round(zoom * 100) / 100;
    zoom = Math.max(MIN, Math.min(MAX, zoom));
    target.style.setProperty('--preview-zoom', String(zoom));
    document.documentElement.style.setProperty('--preview-zoom', String(zoom));
    if (labelEl) labelEl.textContent = `${Math.round(zoom * 100)}%`;
    try {
      localStorage.setItem(STORAGE_KEY, String(zoom));
    } catch {
      // ignore
    }
    onChange?.(zoom);
  }

  function setZoom(next) {
    zoom = Number(next) || 1;
    apply();
  }

  function zoomIn() {
    setZoom(zoom + STEP);
  }

  function zoomOut() {
    setZoom(zoom - STEP);
  }

  function reset() {
    setZoom(1);
  }

  minusBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoomOut();
  });
  plusBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoomIn();
  });
  resetBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    reset();
  });

  // 键盘：⌘/Ctrl + = / - / 0（仅 Markdown 预览模式）
  const onKey = (e) => {
    if (document.body.classList.contains('mode-plain')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      zoomIn();
    } else if (e.key === '-') {
      e.preventDefault();
      zoomOut();
    } else if (e.key === '0') {
      e.preventDefault();
      reset();
    }
  };
  window.addEventListener('keydown', onKey);

  apply();

  return {
    getZoom: () => zoom,
    setZoom,
    zoomIn,
    zoomOut,
    reset,
    destroy() {
      window.removeEventListener('keydown', onKey);
    },
  };
}
