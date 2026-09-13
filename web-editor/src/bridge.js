/**
 * Swift ↔ JS 消息通道封装。
 * JS → Swift: window.webkit.messageHandlers.editorBridge.postMessage
 * Swift → JS: window.EditorAPI.* （由 main 挂载）
 */

const HANDLER = 'editorBridge';

export function postToSwift(payload) {
  try {
    const bridge = window.webkit?.messageHandlers?.[HANDLER];
    if (bridge) {
      bridge.postMessage(payload);
      return true;
    }
  } catch (err) {
    console.warn('[bridge] postMessage failed', err);
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
