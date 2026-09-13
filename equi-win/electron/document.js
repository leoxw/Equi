'use strict';

const path = require('path');
const fs = require('fs');

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdwn', 'mkdn']);

function kindMarkdown() {
  return { type: 'markdown', pathExtension: 'md', webMode: 'markdown', statusLabel: 'Markdown' };
}

function kindPlain(ext) {
  const e = String(ext || 'txt').replace(/^\./, '').toLowerCase() || 'txt';
  return { type: 'plain', pathExtension: e, webMode: 'plain', statusLabel: `纯文本 (.${e})` };
}

function inferKind(filePath) {
  const ext = path.extname(filePath || '').replace(/^\./, '').toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return kindMarkdown();
  return kindPlain(ext || 'txt');
}

/** 与 macOS DocumentModel 对齐：每窗口一份。 */
class DocumentModel {
  constructor() {
    this.content = '';
    this.filePath = null;
    this.isDirty = false;
    this.wordCount = 0;
    this.characterCount = 0;
    this.isEditorReady = false;
    this.editorLoadError = null;
    this.kind = kindMarkdown();
    this.nativeRevision = 0;
  }

  markEditorFailed(message) {
    this.editorLoadError = message;
    this.isEditorReady = false;
  }

  markEditorReady() {
    this.editorLoadError = null;
    this.isEditorReady = true;
  }

  get displayTitle() {
    if (this.filePath) return path.basename(this.filePath);
    const ext = this.kind.pathExtension;
    return this.isDirty ? `未命名.${ext} — 已编辑` : `未命名.${ext}`;
  }

  get windowTitle() {
    const name = this.filePath
      ? path.basename(this.filePath, path.extname(this.filePath))
      : '未命名';
    return this.isDirty ? `${name} — 已编辑` : name;
  }

  applyWebUpdate({ markdown, dirty, wordCount, characterCount }) {
    if (this.content !== markdown) this.content = markdown;
    this.isDirty = !!dirty;
    this.wordCount = wordCount | 0;
    this.characterCount = characterCount | 0;
  }

  replaceContent(markdown, markingClean = false) {
    this.content = markdown ?? '';
    this.nativeRevision = (this.nativeRevision + 1) >>> 0 || 1;
    this.isDirty = !markingClean;
    this.recalculateStats();
  }

  recalculateStats() {
    const trimmed = this.content.trim();
    if (!trimmed) {
      this.wordCount = 0;
      this.characterCount = 0;
      return;
    }
    this.characterCount = [...this.content].length;
    const latin = trimmed.split(/\s+/).filter(Boolean).length;
    let cjk = 0;
    for (const ch of trimmed) {
      const cp = ch.codePointAt(0);
      if (
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x3040 && cp <= 0x30ff)
      ) {
        cjk += 1;
      }
    }
    this.wordCount = Math.max(latin, cjk);
  }

  newDocument() {
    this.filePath = null;
    this.kind = kindMarkdown();
    this.replaceContent('', true);
  }

  loadFromPath(filePath) {
    const ext = path.extname(filePath || '').toLowerCase().replace(/^\./, '');
    const imageExts = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'svg',
    ]);
    if (imageExts.has(ext)) {
      const err = new Error('图片请拖入编辑器正文插入，不能作为文档打开。');
      err.code = 'EQUI_IMAGE_NOT_DOCUMENT';
      throw err;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    this.filePath = filePath;
    this.kind = inferKind(filePath);
    this.replaceContent(text, true);
  }

  writeToPath(filePath) {
    fs.writeFileSync(filePath, this.content, 'utf8');
    this.filePath = filePath;
    this.isDirty = false;
  }

  /** 文稿 `Notes.md` → 文件夹名 `Notesmedia`（仅插入媒体时创建）。 */
  get mediaFolderName() {
    if (!this.filePath) return null;
    return path.basename(this.filePath, path.extname(this.filePath)) + 'media';
  }

  get mediaFolderPath() {
    if (!this.filePath || !this.mediaFolderName) return null;
    return path.join(path.dirname(this.filePath), this.mediaFolderName);
  }

  /** file URL（尾部带 /），供 Web 解析相对媒体路径。 */
  get documentDirectoryURL() {
    if (!this.filePath) return null;
    const dir = path.dirname(this.filePath);
    let href = require('url').pathToFileURL(dir).href;
    if (!href.endsWith('/')) href += '/';
    return href;
  }

  ensureMediaFolder() {
    const folder = this.mediaFolderPath;
    if (!folder) {
      const err = new Error('请先保存文稿，再插入图片或媒体文件。');
      err.code = 'EQUI_NEED_SAVE';
      throw err;
    }
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
  }

  uniqueMediaFileName(original, folder) {
    const trimmed = String(original || '').trim() || 'image.png';
    let candidate = trimmed;
    const ext = path.extname(trimmed);
    const stem = path.basename(trimmed, ext);
    let index = 1;
    while (fs.existsSync(path.join(folder, candidate))) {
      candidate = ext ? `${stem}-${index}${ext}` : `${stem}-${index}`;
      index += 1;
    }
    return candidate;
  }

  /** 写入媒体目录，返回 Markdown 相对路径（如 Notesmedia/a.png）。 */
  importMediaData(buffer, preferredName) {
    const folder = this.ensureMediaFolder();
    const destName = this.uniqueMediaFileName(preferredName, folder);
    const dest = path.join(folder, destName);
    fs.writeFileSync(dest, buffer);
    return `${this.mediaFolderName}/${destName}`;
  }

  importMediaFile(sourcePath) {
    const folder = this.ensureMediaFolder();
    const destName = this.uniqueMediaFileName(path.basename(sourcePath), folder);
    const dest = path.join(folder, destName);
    fs.copyFileSync(sourcePath, dest);
    return `${this.mediaFolderName}/${destName}`;
  }

  absoluteMediaURL(relativePath) {
    if (!this.filePath) return null;
    const abs = path.join(path.dirname(this.filePath), relativePath);
    return require('url').pathToFileURL(abs).href;
  }

  snapshot() {
    return {
      content: this.content,
      filePath: this.filePath,
      isDirty: this.isDirty,
      wordCount: this.wordCount,
      characterCount: this.characterCount,
      isEditorReady: this.isEditorReady,
      editorLoadError: this.editorLoadError,
      kind: this.kind,
      nativeRevision: this.nativeRevision,
      displayTitle: this.displayTitle,
      windowTitle: this.windowTitle,
    };
  }
}

function saveFormatChoices(kind) {
  const list = [
    { id: 'markdown', title: 'Markdown (.md)', pathExtension: 'md', documentKind: kindMarkdown() },
    { id: 'plainText', title: '纯文本 (.txt)', pathExtension: 'txt', documentKind: kindPlain('txt') },
  ];
  if (kind?.type === 'plain') {
    const e = (kind.pathExtension || '').toLowerCase();
    if (e && e !== 'txt' && e !== 'text' && !MARKDOWN_EXTS.has(e)) {
      list.unshift({
        id: `original:${e}`,
        title: `原格式 (.${e})`,
        pathExtension: e,
        documentKind: kindPlain(e),
      });
    }
  }
  return list;
}

const WELCOME_MARKDOWN = `# MarkDuo

左侧编辑 **原始 Markdown**（纯文本），右侧进行 markdown 渲染后排版。

- 焦点在左：纯文本 → 渲染
- 焦点在右：渲染 → 纯文本
- Tab 分隔表会渲染为表格，但不会改写源文件中的制表符

> 通过 Ctrl+O / Ctrl+S 由 Windows 原生层管理文件。
`;

module.exports = {
  DocumentModel,
  inferKind,
  kindMarkdown,
  kindPlain,
  saveFormatChoices,
  MARKDOWN_EXTS,
  WELCOME_MARKDOWN,
};
