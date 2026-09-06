import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.resolve(__dirname, '../Equi/Resources/Editor');

/**
 * WKWebView 对 file:// 下的外链 <script>/<link> 经常静默失败。
 * 构建时把 CSS + JS 全部内联进单一 index.html，用 loadHTMLString / loadFileURL 都能跑。
 */
export default defineConfig({
  root: '.',
  base: './',
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 100_000_000,
    lib: {
      entry: path.resolve(__dirname, 'src/main.js'),
      name: 'EquiEditor',
      formats: ['iife'],
      fileName: () => 'assets/editor.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'equi-inline-single-html',
      closeBundle() {
        const assetsDir = path.join(outDir, 'assets');
        fs.mkdirSync(assetsDir, { recursive: true });

        // 统一 CSS 文件名
        let cssName = 'style.css';
        if (fs.existsSync(assetsDir)) {
          for (const name of fs.readdirSync(assetsDir)) {
            if (name.endsWith('.css')) {
              const target = path.join(assetsDir, 'style.css');
              if (name !== 'style.css') {
                fs.renameSync(path.join(assetsDir, name), target);
              }
              cssName = 'style.css';
            }
          }
        }

        const jsPath = path.join(assetsDir, 'editor.js');
        const cssPath = path.join(assetsDir, cssName);
        if (!fs.existsSync(jsPath)) {
          throw new Error(`缺少 ${jsPath}`);
        }

        const js = fs.readFileSync(jsPath, 'utf8');
        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

        // 转义 </script> 防止提前闭合
        const safeJs = js.replace(/<\/script/gi, '<\\/script');

        const html = `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob: 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'" />
<title>Equi</title>
<style>
${css}
</style>
</head>
<body>
<div data-equi-probe="1" style="position:fixed;z-index:99999;left:8px;top:8px;padding:4px 8px;border-radius:6px;font:11px -apple-system;background:#0a7a5c;color:#fff;opacity:.9">Equi WebView OK</div>
<div id="app" class="app">
  <aside class="pane pane-outline" id="pane-outline" aria-label="目录导航">
    <div id="outline-nav" class="outline-nav-host"></div>
  </aside>
  <div class="pane pane-source" id="pane-source">
    <div class="pane-label">Markdown</div>
    <div id="source-editor" class="editor-host"></div>
  </div>
  <div class="splitter" id="splitter" role="separator" aria-orientation="vertical" aria-label="调整分栏" tabindex="0"></div>
  <div class="pane pane-wysiwyg" id="pane-wysiwyg">
    <div class="pane-toolbar">
      <div class="pane-label">预览</div>
      <div class="preview-zoom" role="group" aria-label="预览缩放">
        <button type="button" id="zoom-out" class="zoom-btn" title="缩小预览" aria-label="缩小">−</button>
        <button type="button" id="zoom-reset" class="zoom-label" title="重置为 100%">100%</button>
        <button type="button" id="zoom-in" class="zoom-btn" title="放大预览" aria-label="放大">+</button>
      </div>
    </div>
    <div id="wysiwyg-editor" class="editor-host prose"></div>
  </div>
</div>
<script>
try {
  window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.editorBridge &&
  window.webkit.messageHandlers.editorBridge.postMessage({ type: 'log', message: 'html-inline-exec' });
} catch (e) {}
</script>
<script>
${safeJs}
</script>
</body>
</html>
`;

        fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
        // 保留拆分资源便于调试；运行时优先用内联 index.html
        console.log(
          `[equi] inlined index.html (${(html.length / 1024).toFixed(0)} KB)`
        );
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
