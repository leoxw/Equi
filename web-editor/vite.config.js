import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.resolve(__dirname, '../Equi/Resources/Editor');

/**
 * WKWebView 对 file:// + ES Module（type="module"）支持不可靠。
 * 使用 IIFE 经典脚本，保证离线本地加载。
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
    assetsInlineLimit: 0,
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
      name: 'equi-write-index-html',
      closeBundle() {
        const html = `<!DOCTYPE html>
<html lang="zh-Hans">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <title>Equi</title>
    <link rel="stylesheet" href="./assets/style.css" />
  </head>
  <body>
    <div id="app" class="app">
      <div class="pane pane-source" id="pane-source">
        <div class="pane-label">Markdown</div>
        <div id="source-editor" class="editor-host"></div>
      </div>
      <div
        class="splitter"
        id="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整分栏"
        tabindex="0"
      ></div>
      <div class="pane pane-wysiwyg" id="pane-wysiwyg">
        <div class="pane-label">所见即所得</div>
        <div id="wysiwyg-editor" class="editor-host prose"></div>
      </div>
    </div>
    <script src="./assets/editor.js"></script>
  </body>
</html>
`;
        fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

        // Vite lib 模式 CSS 可能叫 style.css 或入口名.css，统一成 style.css
        const assetsDir = path.join(outDir, 'assets');
        if (fs.existsSync(assetsDir)) {
          for (const name of fs.readdirSync(assetsDir)) {
            if (name.endsWith('.css') && name !== 'style.css') {
              fs.renameSync(path.join(assetsDir, name), path.join(assetsDir, 'style.css'));
            }
          }
        }
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
