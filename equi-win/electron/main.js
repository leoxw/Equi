'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  DocumentModel,
  saveFormatChoices,
  WELCOME_MARKDOWN,
} = require('./document');

/** @type {Map<number, Session>} */
const sessions = new Map();
const isDev = process.argv.includes('--dev');

/**
 * @typedef {{
 *   win: Electron.BrowserWindow,
 *   doc: DocumentModel,
 *   lastPushedRevision: number,
 *   lastPushedMode: string|null,
 *   editorReady: boolean
 * }} Session
 */

function editorHtmlPath() {
  const candidates = [
    path.join(__dirname, '..', 'resources', 'EquiEditor.html'),
    path.join(__dirname, '..', 'resources', 'Editor', 'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 100000) return p;
  }
  return candidates[0];
}

function shellHtmlPath() {
  return path.join(__dirname, '..', 'shell', 'index.html');
}

function preloadEditorPath() {
  return path.join(__dirname, 'preload-editor.js');
}

function broadcastState(wcId) {
  const s = sessions.get(wcId);
  if (!s || s.win.isDestroyed()) return;
  s.win.webContents.send('doc:state', s.doc.snapshot());
  s.win.setTitle(`${s.doc.windowTitle} — Equi`);
}

function sessionFromEvent(event) {
  return sessions.get(event.sender.id) || null;
}

function createWindow(openPath) {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: '#f6f5f2',
    title: 'Equi',
    webPreferences: {
      preload: path.join(__dirname, 'preload-shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  /** @type {Session} */
  const session = {
    win,
    doc: new DocumentModel(),
    lastPushedRevision: 0,
    lastPushedMode: null,
    editorReady: false,
  };
  sessions.set(win.webContents.id, session);

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => sessions.delete(win.webContents.id));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(shellHtmlPath(), {
    query: {
      editor: editorHtmlPath(),
      preload: preloadEditorPath(),
    },
  });

  win.webContents.on('did-finish-load', () => {
    broadcastState(win.webContents.id);
    if (openPath) {
      try {
        session.doc.loadFromPath(openPath);
        broadcastState(win.webContents.id);
        pushToEditor(session);
      } catch (err) {
        dialog.showErrorBox('无法打开文件', String(err.message || err));
      }
    }
  });

  return win;
}

function evalInEditor(session, js) {
  if (session.win.isDestroyed()) return Promise.resolve(null);
  return session.win.webContents.executeJavaScript(
    `window.__equiEvalEditor && window.__equiEvalEditor(${JSON.stringify(js)})`
  );
}

function pushEditingMode(session) {
  if (!session.editorReady) return;
  const mode = session.doc.kind.webMode;
  if (mode === session.lastPushedMode) return;
  session.lastPushedMode = mode;
  evalInEditor(
    session,
    `window.EditorAPI && window.EditorAPI.setEditingMode(${JSON.stringify({ mode })})`
  );
}

function pushNativeContent(session) {
  if (!session.editorReady) return;
  const rev = session.doc.nativeRevision;
  if (rev === session.lastPushedRevision) return;
  session.lastPushedRevision = rev;
  const payload = {
    markdown: session.doc.content,
    revision: rev,
    markClean: !session.doc.isDirty,
  };
  evalInEditor(
    session,
    `window.EditorAPI && window.EditorAPI.setMarkdown(${JSON.stringify(payload)})`
  );
}

function pushToEditor(session) {
  pushEditingMode(session);
  pushNativeContent(session);
}

function handleBridge(session, body) {
  const type = body?.type || '';
  switch (type) {
    case 'ready': {
      session.editorReady = true;
      session.doc.markEditorReady();
      session.lastPushedRevision = 0;
      session.lastPushedMode = null;
      if (!session.doc.content) {
        session.doc.replaceContent(WELCOME_MARKDOWN, true);
      }
      pushToEditor(session);
      broadcastState(session.win.webContents.id);
      break;
    }
    case 'contentChange':
    case 'contentChanged':
{
      session.doc.applyWebUpdate({
        markdown: body.markdown ?? '',
        dirty: body.dirty ?? true,
        wordCount: body.wordCount ?? 0,
        characterCount: body.characterCount ?? 0,
      });
      broadcastState(session.win.webContents.id);
      break;
    }
    case 'dirty': {
      if (typeof body.dirty === 'boolean') {
        session.doc.isDirty = body.dirty;
        broadcastState(session.win.webContents.id);
      }
      break;
    }
    case 'log': {
      if (isDev) console.log('[Editor]', body.message);
      break;
    }
    case 'loadError': {
      session.doc.markEditorFailed(body.message || '编辑器启动失败');
      broadcastState(session.win.webContents.id);
      break;
    }
    default:
      break;
  }
}

function runCommand(session, command) {
  const cmds = {
    undo: `window.EditorAPI && window.EditorAPI.undo()`,
    redo: `window.EditorAPI && window.EditorAPI.redo()`,
    focusSource: `window.EditorAPI && window.EditorAPI.focusPane('source')`,
    focusWysiwyg:
      session.doc.kind.webMode === 'markdown'
        ? `window.EditorAPI && window.EditorAPI.focusPane('wysiwyg')`
        : `window.EditorAPI && window.EditorAPI.focusPane('source')`,
    zoomIn: `window.EditorAPI && window.EditorAPI.setPreviewZoom('in')`,
    zoomOut: `window.EditorAPI && window.EditorAPI.setPreviewZoom('out')`,
    zoomReset: `window.EditorAPI && window.EditorAPI.setPreviewZoom('reset')`,
    toggleOutline: `window.EditorAPI && window.EditorAPI.toggleOutline()`,
  };
  if (cmds[command]) evalInEditor(session, cmds[command]);
}

async function openDocument(session) {
  const { canceled, filePaths } = await dialog.showOpenDialog(session.win, {
    title: '打开',
    properties: ['openFile'],
    filters: [
      {
        name: '文本与 Markdown',
        extensions: [
          'md', 'markdown', 'mdown', 'txt', 'text', 'json', 'xml', 'csv', 'log',
          'js', 'ts', 'css', 'html', 'yml', 'yaml', 'toml', 'swift',
        ],
      },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths?.[0]) return false;
  try {
    session.doc.loadFromPath(filePaths[0]);
    session.lastPushedRevision = 0;
    pushToEditor(session);
    broadcastState(session.win.webContents.id);
    return true;
  } catch (err) {
    dialog.showErrorBox('无法打开文件', String(err.message || err));
    return false;
  }
}

async function saveAsDocument(session) {
  const choices = saveFormatChoices(session.doc.kind);
  const defaultIdx = Math.max(
    0,
    choices.findIndex((c) => c.pathExtension === session.doc.kind.pathExtension)
  );
  const { response } = await dialog.showMessageBox(session.win, {
    type: 'question',
    buttons: [...choices.map((c) => c.title), '取消'],
    defaultId: defaultIdx,
    cancelId: choices.length,
    title: '存储为',
    message: '选择保存文件格式',
    detail: '随后将选择保存位置。',
  });
  if (response < 0 || response >= choices.length) return false;
  const choice = choices[response];
  const base = session.doc.filePath
    ? path.basename(session.doc.filePath, path.extname(session.doc.filePath))
    : '未命名';
  const { canceled, filePath } = await dialog.showSaveDialog(session.win, {
    title: '存储为',
    defaultPath: `${base}.${choice.pathExtension}`,
    filters: [
      { name: choice.title, extensions: [choice.pathExtension] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return false;

  let target = filePath;
  const wanted = choice.pathExtension.toLowerCase();
  const ext = path.extname(target).replace(/^\./, '').toLowerCase();
  if (!ext) target = `${target}.${wanted}`;
  else if (ext !== wanted) {
    target = path.join(
      path.dirname(target),
      `${path.basename(target, path.extname(target))}.${wanted}`
    );
  }

  try {
    session.doc.kind = choice.documentKind;
    session.doc.writeToPath(target);
    session.lastPushedMode = null;
    pushEditingMode(session);
    broadcastState(session.win.webContents.id);
    evalInEditor(
      session,
      `window.EditorAPI && window.EditorAPI.markClean(${JSON.stringify(session.doc.content)})`
    );
    return true;
  } catch (err) {
    dialog.showErrorBox('无法保存文件', String(err.message || err));
    return false;
  }
}

async function saveDocument(session) {
  if (session.doc.filePath) {
    try {
      session.doc.writeToPath(session.doc.filePath);
      broadcastState(session.win.webContents.id);
      evalInEditor(
        session,
        `window.EditorAPI && window.EditorAPI.markClean(${JSON.stringify(session.doc.content)})`
      );
      return true;
    } catch (err) {
      dialog.showErrorBox('无法保存文件', String(err.message || err));
      return false;
    }
  }
  return saveAsDocument(session);
}

function focusedSession() {
  const win = BrowserWindow.getFocusedWindow();
  return win ? sessions.get(win.webContents.id) || null : null;
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        {
          label: '打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const s = focusedSession();
            if (s) openDocument(s);
          },
        },
        { type: 'separator' },
        {
          label: '存储',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const s = focusedSession();
            if (s) saveDocument(s);
          },
        },
        {
          label: '存储为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const s = focusedSession();
            if (s) saveAsDocument(s);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        {
          label: '撤销',
          accelerator: 'CmdOrCtrl+Z',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'undo');
          },
        },
        {
          label: '重做',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'redo');
          },
        },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '聚焦源码',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'focusSource');
          },
        },
        {
          label: '聚焦预览编辑',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'focusWysiwyg');
          },
        },
        { type: 'separator' },
        {
          label: '放大预览',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'zoomIn');
          },
        },
        {
          label: '缩小预览',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'zoomOut');
          },
        },
        {
          label: '重置预览缩放',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'zoomReset');
          },
        },
        {
          label: '显示/隐藏目录',
          click: () => {
            const s = focusedSession();
            if (s) runCommand(s, 'toggleOutline');
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(isDev ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('doc:getState', (event) => sessionFromEvent(event)?.doc.snapshot() ?? null);
  ipcMain.handle('doc:open', async (event) => {
    const s = sessionFromEvent(event);
    return s ? openDocument(s) : false;
  });
  ipcMain.handle('doc:save', async (event) => {
    const s = sessionFromEvent(event);
    return s ? saveDocument(s) : false;
  });
  ipcMain.handle('doc:saveAs', async (event) => {
    const s = sessionFromEvent(event);
    return s ? saveAsDocument(s) : false;
  });
  ipcMain.handle('app:newWindow', () => {
    createWindow();
    return true;
  });
  ipcMain.on('editor:command', (event, command) => {
    const s = sessionFromEvent(event);
    if (s) runCommand(s, command);
  });
  ipcMain.on('editor:bridge', (event, payload) => {
    const s = sessionFromEvent(event);
    if (s) handleBridge(s, payload);
  });
}

function fileFromArgv(argv) {
  return argv
    .slice(1)
    .find((a) => a && !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = fileFromArgv(argv);
    if (file) createWindow(file);
    else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      } else createWindow();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    createWindow(fileFromArgv(process.argv));
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
