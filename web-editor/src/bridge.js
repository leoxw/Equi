/**
 * 原生宿主 ↔ JS 消息通道封装。
 * - macOS: window.webkit.messageHandlers.editorBridge.postMessage
 * - Windows Electron: preload 注入同名 webkit.messageHandlers，
 *   并提供 window.equiNative.postMessage 兜底
 * - 原生 → JS: window.EditorAPI.* （由宿主挂载）
 */

const HANDLER = 'editorBridge';

/** 是否存在任一原生桥（有桥时欢迎文案由宿主注入）。 */
export function hasNativeBridge() {
  if (window.webkit?.messageHandlers?.[HANDLER]) return true;
  if (window.equiNative?.postMessage) return true;
  if (window.chrome?.webview?.postMessage) return true;
  if (window.__EQUI_EDITOR__?.bridgeReady) return true;
  return false;
}

export function postToSwift(payload) {
  try {
    const webkitBridge = window.webkit?.messageHandlers?.[HANDLER];
    if (webkitBridge) {
      webkitBridge.postMessage(payload);
      return true;
    }
  } catch (err) {
    console.warn('[bridge] webkit postMessage failed', err);
  }

  try {
    if (window.equiNative?.postMessage) {
      window.equiNative.postMessage(payload);
      return true;
    }
  } catch (err) {
    console.warn('[bridge] equiNative postMessage failed', err);
  }

  try {
    if (window.chrome?.webview?.postMessage) {
      window.chrome.webview.postMessage(payload);
      return true;
    }
  } catch (err) {
    console.warn('[bridge] chrome.webview postMessage failed', err);
  }

  // 浏览器开发态兜底
  if (import.meta.env?.DEV) {
    console.debug('[bridge:dev]', payload);
  }
  return false;
}

export function notifyReady() {
  postToSwift({ type: 'ready', ts: Date.now() });
}

export function notifyContentChange({ markdown, dirty, wordCount, characterCount }) {
  postToSwift({
    type: 'contentChange',
    markdown,
    dirty,
    wordCount,
    characterCount,
    ts: Date.now(),
  });
}

export function notifyDirty(dirty) {
  postToSwift({ type: 'dirty', dirty });
}

export function logToSwift(message) {
  postToSwift({ type: 'log', message: String(message) });
}

export function notifyLoadError(message) {
  postToSwift({ type: 'loadError', message: String(message) });
}
