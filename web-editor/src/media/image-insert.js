/**
 * 拖拽 / 粘贴图片 → 插入 Markdown 图片（data URL，适配沙盒 CSP img-src data:）。
 * 同时拦截默认行为，避免 WKWebView / Electron 把图片当成「打开文件」导航。
 */

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|tiff?)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|heic)$/i;

function isImageFile(file) {
  if (!file) return false;
  if (file.type && IMAGE_MIME.test(file.type)) return true;
  return IMAGE_EXT.test(file.name || '');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function altFromName(name) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '');
  return base.replace(/[\[\]]/g, '') || 'image';
}

/**
 * @param {{ insertImage: (payload: { src: string, alt?: string }) => boolean | void }} api
 */
export function installImageInsert({ insertImage }) {
  if (typeof insertImage !== 'function') return () => {};

  async function handleFiles(fileList) {
    const files = [...(fileList || [])].filter(isImageFile);
    if (!files.length) return false;
    for (const file of files) {
      try {
        const src = await readFileAsDataURL(file);
        if (!src) continue;
        insertImage({ src, alt: altFromName(file.name) });
      } catch (err) {
        console.warn('[image-insert] failed', file?.name, err);
      }
    }
    return true;
  }

  function onDragOver(event) {
    const types = event.dataTransfer?.types;
    if (!types) return;
    const list = [...types];
    if (list.includes('Files') || list.includes('application/x-moz-file')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }
  }

  async function onDrop(event) {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    const hasImage = [...files].some(isImageFile);
    if (!hasImage) return;
    event.preventDefault();
    event.stopPropagation();
    await handleFiles(files);
  }

  async function onPaste(event) {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.kind === 'file' && IMAGE_MIME.test(item.type || '')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (!imageFiles.length) return;
    event.preventDefault();
    event.stopPropagation();
    await handleFiles(imageFiles);
  }

  // 捕获阶段优先于编辑器默认处理，阻止 WebView 导航到 file://
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('paste', onPaste, true);

  return () => {
    document.removeEventListener('dragover', onDragOver, true);
    document.removeEventListener('drop', onDrop, true);
    document.removeEventListener('paste', onPaste, true);
  };
}

/** 供原生桥调用：直接插入已编码的 data URL / http(s) 路径 */
export function buildMarkdownImage({ src, alt }) {
  const safeAlt = String(alt || 'image').replace(/[\[\]]/g, '');
  const safeSrc = String(src || '').trim();
  if (!safeSrc) return '';
  return `![${safeAlt}](${safeSrc})`;
}
