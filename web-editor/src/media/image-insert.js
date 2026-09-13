/**
 * 拖拽 / 粘贴图片 → 经原生桥写入「文稿名media」文件夹，再插入相对路径。
 * 无原生桥时（浏览器开发态）回退为 data URL。
 */

import { postToSwift, hasNativeBridge } from '../bridge.js';

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|tiff?)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|heic)$/i;

const pendingImports = new Map();
let requestSeq = 0;

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

/** 请求原生写入 {stem}media，返回 { relativePath, displaySrc, alt }。 */
export function requestImportMedia({ fileName, base64, mimeType }) {
  const requestId = `media-${Date.now()}-${++requestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingImports.delete(requestId);
      reject(new Error('导入媒体超时'));
    }, 60000);
    pendingImports.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    const ok = postToSwift({
      type: 'importMedia',
      requestId,
      fileName: fileName || 'image.png',
      mimeType: mimeType || '',
      base64,
    });
    if (!ok) {
      pendingImports.delete(requestId);
      clearTimeout(timer);
      reject(new Error('原生桥不可用'));
    }
  });
}

/** 原生回调：window.EditorAPI.completeImportMedia */
export function completeImportMedia(payload = {}) {
  const requestId = payload.requestId;
  const pending = pendingImports.get(requestId);
  if (!pending) return;
  pendingImports.delete(requestId);
  if (payload.ok) {
    pending.resolve({
      relativePath: payload.relativePath,
      displaySrc: payload.displaySrc || payload.relativePath,
      alt: payload.alt || 'image',
    });
  } else {
    pending.reject(new Error(payload.error || '导入媒体失败'));
  }
}

/**
 * @param {{ insertImage: (payload: { src: string, markdownSrc?: string, alt?: string }) => boolean | void }} api
 */
export function installImageInsert({ insertImage }) {
  if (typeof insertImage !== 'function') return () => {};

  async function importOneFile(file) {
    const alt = altFromName(file.name);
    if (hasNativeBridge()) {
      const dataUrl = await readFileAsDataURL(file);
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const imported = await requestImportMedia({
        fileName: file.name || 'image.png',
        base64,
        mimeType: file.type || '',
      });
      insertImage({
        src: imported.displaySrc,
        markdownSrc: imported.relativePath,
        alt: imported.alt || alt,
      });
      return;
    }
    const src = await readFileAsDataURL(file);
    if (src) insertImage({ src, markdownSrc: src, alt });
  }

  async function handleFiles(fileList) {
    const files = [...(fileList || [])].filter(isImageFile);
    if (!files.length) return false;
    for (const file of files) {
      try {
        await importOneFile(file);
      } catch (err) {
        console.warn('[image-insert] failed', file?.name, err);
        window.alert?.(err?.message || '插入图片失败');
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
    if (![...files].some(isImageFile)) return;
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

  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('paste', onPaste, true);

  return () => {
    document.removeEventListener('dragover', onDragOver, true);
    document.removeEventListener('drop', onDrop, true);
    document.removeEventListener('paste', onPaste, true);
  };
}

export function buildMarkdownImage({ src, alt }) {
  const safeAlt = String(alt || 'image').replace(/[\[\]]/g, '');
  const safeSrc = String(src || '').trim();
  if (!safeSrc) return '';
  return `![${safeAlt}](${safeSrc})`;
}
