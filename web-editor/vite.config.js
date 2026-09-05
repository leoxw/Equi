import { defineConfig } from 'vite';
import path from 'node:path';

// 产物直接写入 macOS App Bundle 的 Resources/Editor
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../Equi/Resources/Editor'),
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/editor.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
