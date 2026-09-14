/**
 * 左右分栏拖拽调整宽度。
 */

export function installSplitter({ splitter, leftPane, container, storageKey = 'mde.splitRatio' }) {
  const MIN = 0.22;
  const MAX = 0.78;

  // about:blank / 部分 file:// 下 localStorage 会抛 SecurityError，必须吞掉
  let ratio = 0.5;
  try {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= MIN && stored <= MAX) ratio = stored;
  } catch {
    // ignore
  }

  function apply(r) {
    ratio = Math.max(MIN, Math.min(MAX, r));
    const width = container.clientWidth;
    const splitterW = splitter.getBoundingClientRect().width || 6;
    leftPane.style.width = `${Math.round((width - splitterW) * ratio)}px`;
  }

  apply(ratio);

  const onResize = () => apply(ratio);
  window.addEventListener('resize', onResize);

  let dragging = false;

  function onPointerDown(e) {
    dragging = true;
    splitter.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
    splitter.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    apply(x / rect.width);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing');
    try {
      localStorage.setItem(storageKey, String(ratio));
    } catch {
      // file:// 下 localStorage 可能受限，忽略
    }
    splitter.releasePointerCapture?.(e.pointerId);
  }

  splitter.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // 键盘微调
  splitter.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      apply(ratio - 0.02);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      apply(ratio + 0.02);
      e.preventDefault();
    }
  });

  return {
    getRatio: () => ratio,
    setRatio: apply,
    destroy: () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      splitter.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
