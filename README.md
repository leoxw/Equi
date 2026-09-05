# Markdown Dual Editor

macOS 独占的原生双栏 Markdown 编辑器：SwiftUI + AppKit 外壳，WKWebView 内嵌离线 Web 编辑内核（CodeMirror 6 + TipTap）。

## 功能概览

- 毛玻璃 / 透明标题栏（`titlebarAppearsTransparent` + `fullSizeContentView`）
- 标准红绿灯位置与 ⌘O / ⌘S / ⌘⇧S / ⌘Z 等系统快捷键
- 左栏 Raw Markdown（CodeMirror 6）↔ 右栏 WYSIWYG（TipTap / ProseMirror）
- 分栏拖拽、焦点驱动的双向同步锁、防抖、滚动百分比同步
- 资源完全离线打包，无外网依赖

---

## 目录结构（Xcode / Cursor）

```
.
├── project.yml                          # XcodeGen 工程描述（可选）
├── README.md
├── docs/
│   └── WEBKIT_SECURITY.md               # 本地 file:// 安全策略说明
├── MarkdownDualEditor/
│   ├── App/
│   │   ├── MarkdownDualEditorApp.swift  # @main、Commands 快捷键
│   │   └── WindowChrome.swift           # 毛玻璃窗口配置
│   ├── Models/
│   │   └── DocumentModel.swift          # 文档内容 / 路径 / dirty / 字数
│   ├── Bridge/
│   │   ├── WebViewBridge.swift          # NSViewRepresentable + WK 消息桥
│   │   └── EditorCommandBus.swift       # 原生 → Web 命令总线
│   ├── Views/
│   │   └── ContentView.swift            # 工具栏 + WebView + 状态栏
│   ├── Resources/
│   │   └── Editor/                      # ★ 构建产物（打进 App Bundle）
│   │       ├── index.html
│   │       └── assets/
│   │           ├── editor.js
│   │           └── style.css
│   └── Supporting/
│       ├── Info.plist
│       ├── MarkdownDualEditor.entitlements
│       └── Assets.xcassets/
└── web-editor/                          # 前端源码（Vite 打包）
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.js
        ├── bridge.js
        ├── styles/editor.css
        ├── editors/
        │   ├── source-editor.js         # CodeMirror 6
        │   └── wysiwyg-editor.js        # TipTap
        ├── sync/
        │   ├── sync-engine.js           # sourceOfTruth / Sync Lock
        │   └── markdown-io.js           # MD ↔ HTML
        └── ui/splitter.js
```

### 在 Xcode 中组织

1. **推荐：XcodeGen**
   ```bash
   brew install xcodegen
   cd <repo>
   xcodegen generate
   open MarkdownDualEditor.xcodeproj
   ```
2. **手动创建工程**
   - File → New → Project → macOS → App（SwiftUI，最低 macOS 13）
   - 将 `MarkdownDualEditor/` 下 Swift 文件按文件夹加入 Target
   - 将整个 `Resources/Editor` **以 Folder Reference（蓝色文件夹）** 加入 *Copy Bundle Resources*，保证运行时路径为 `…/Contents/Resources/Editor/index.html`
   - 设置 `Info.plist`、`Entitlements`、Deployment Target = 13.0
3. **Cursor**：直接编辑本仓库；前端在 `web-editor/` 用 Vite 开发，Swift 在 macOS 上用 Xcode 编译运行。

### 构建前端 Bundle

```bash
cd web-editor
npm install
npm run build   # 输出到 MarkdownDualEditor/Resources/Editor
```

浏览器调试：`npm run dev`（无 `webkit.messageHandlers` 时自动加载欢迎文稿）。

---

## 架构说明

### 1. 原生外壳

| 模块 | 职责 |
|------|------|
| `DocumentModel` | 文档字符串、文件 URL、dirty、字数；`NSOpenPanel` / `NSSavePanel` |
| `WebViewBridge` | `WKWebView` 配置、加载本地 HTML、`editorBridge` 消息、`evaluateJavaScript` |
| `EditorCommandBus` | 工具栏 / 菜单 → undo/redo/focus |
| `WindowChrome` | 透明标题栏 + unified toolbar |
| `ContentView` | 工具栏、状态栏、桥接宿主 |

### 2. 双向同步协议（Sync Lock）

```
sourceOfTruth ∈ { source | wysiwyg | none }

焦点在左 → sourceOfTruth = source
  左栏变更 ─debounce─→ markdownToHtml → TipTap.setHtmlSilent
  右栏 onUpdate 被忽略（不回写）

焦点在右 → sourceOfTruth = wysiwyg
  右栏变更 ─debounce─→ htmlToMarkdown → CodeMirror.setMarkdownSilent
  左栏 onChange 被忽略

Swift setMarkdown → sourceOfTruth = none，两侧静默灌入
```

- `syncLock` + `requestAnimationFrame` 防止同一次写入引发回声死循环
- 静默写入保留选区映射，活跃侧光标不因对侧更新而跳动
- 滚动按 `scrollTop / (scrollHeight - clientHeight)` 百分比互相同步

### 3. Markdown 互转

官方包 `@tiptap/extension-markdown` 在 npm 上不存在；社区 `tiptap-markdown` 需要 TipTap v3。

本项目采用：

- **marked**（GFM）：Markdown → HTML → TipTap `setContent`
- **turndown + turndown-plugin-gfm**：TipTap HTML → Markdown

等价于「AST / HTML 中转」互转层，离线可控、API 稳定。

### 4. Swift ↔ JS 通道

**JS → Swift**

```js
window.webkit.messageHandlers.editorBridge.postMessage({
  type: 'contentChange', // ready | dirty | log
  markdown, dirty, wordCount, characterCount
})
```

**Swift → JS**

```swift
webView.evaluateJavaScript("window.EditorAPI.setMarkdown({markdown, revision, markClean})")
// 另有：undo() / redo() / focusPane('source'|'wysiwyg')
```

---

## WebKit 本地资源安全策略

详见 [`docs/WEBKIT_SECURITY.md`](docs/WEBKIT_SECURITY.md)。要点：

```swift
config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
webView.loadFileURL(indexURL, allowingReadAccessTo: editorDirectory)
```

配合 HTML CSP（`default-src 'none'; script-src 'self'; connect-src 'none'`）与导航代理（拦截非 `file://` / `about:`），保证编辑器离线且不偷偷出网。

---

## 运行要求

- macOS 13+
- Xcode 15+
- Node.js 20+（仅构建前端时需要）

## 许可

见根目录 `LICENSE`。
