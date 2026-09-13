/**
 * 文稿目录上下文：Markdown 存相对路径（如 Notesmedia/a.png），
 * 预览时解析为 equimedia:/// 或 file://，供 WKWebView / Electron 加载。
 */

let directoryURL = null; // file:///.../ 结尾
let mediaFolderName = null;
let fileName = null;

function prefersEquiMediaScheme() {
  // macOS WKWebView 沙盒下用自定义协议；Electron / 浏览器开发态用 file://
  const meta = window.__EQUI_EDITOR__ || {};
  const platform = String(meta.platform || meta.os || '').toLowerCase();
  return platform === 'macos' || platform === 'mac' || platform === 'darwin';
}

export function setDocumentContext(payload = {}) {
  const dir = payload?.directoryURL || payload?.directoryUrl || null;
  directoryURL = dir ? String(dir) : null;
  if (directoryURL && !directoryURL.endsWith('/')) {
    directoryURL += '/';
  }
  mediaFolderName = payload?.mediaFolderName ? String(payload.mediaFolderName) : null;
  fileName = payload?.fileName ? String(payload.fileName) : null;
}

export function getDocumentContext() {
  return { directoryURL, mediaFolderName, fileName };
}

export function hasDocumentDirectory() {
  return Boolean(directoryURL);
}

/** Markdown / 相对路径 → 可供 <img src> 使用的绝对 URL */
export function resolveMediaSrcForDisplay(src) {
  const s = String(src || '').trim();
  if (!s) return s;
  if (/^(data:|blob:|https?:|file:|equimedia:)/i.test(s)) return s;
  if (!directoryURL && !prefersEquiMediaScheme()) return s;
  const rel = s.replace(/^\/+/, '');
  if (prefersEquiMediaScheme()) {
    const encoded = rel
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return `equimedia:///${encoded}`;
  }
  if (!directoryURL) return s;
  try {
    return new URL(rel, directoryURL).href;
  } catch {
    return s;
  }
}

/** 预览用的绝对 URL → 写回 Markdown 的相对路径 */
export function relativizeMediaSrcForMarkdown(src) {
  const s = String(src || '').trim();
  if (!s) return s;
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  try {
    if (/^equimedia:/i.test(s)) {
      const u = new URL(s);
      let path = decodeURIComponent(u.pathname || '');
      if (path.startsWith('/')) path = path.slice(1);
      return path;
    }
    if (!directoryURL) return s;
    const abs = new URL(s);
    const base = new URL(directoryURL);
    if (abs.protocol !== 'file:') return s;
    let absPath = decodeURIComponent(abs.pathname);
    let basePath = decodeURIComponent(base.pathname);
    if (!basePath.endsWith('/')) basePath += '/';
    if (!absPath.startsWith(basePath)) return s;
    return absPath.slice(basePath.length);
  } catch {
    return s;
  }
}

/** 把 HTML 里的相对 img src 展开为绝对路径，便于 TipTap 显示 */
export function expandMediaSrcInHtml(html) {
  if (!html) return html;
  if (!directoryURL && !prefersEquiMediaScheme()) return html;
  return String(html).replace(
    /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])/gi,
    (full, pre, src, post) => `${pre}${resolveMediaSrcForDisplay(src)}${post}`,
  );
}
