# Equi

跨平台双栏 Markdown 编辑器：共享离线 Web 内核（CodeMirror 6 + TipTap），macOS 用 SwiftUI + WKWebView，Windows 用 Electron + 系统 Chromium。

## 功能概览

- 左栏 Raw Markdown（CodeMirror 6）↔ 右栏 WYSIWYG（TipTap / ProseMirror）
- 分栏拖拽、焦点驱动的双向同步锁、防抖、滚动百分比同步
- 目录导航、预览缩放、右键格式菜单
- 非 Markdown 文件 → 纯文本单栏，另存为可切换 Markdown / txt / 原格式
- 资源完全离线打包，无外网依赖

---

## Windows（Electron）

在 Windows（或本仓库 Cloud Agent）上：

```bash
chmod +x scripts/*.sh
./scripts/build-editor.sh          # 构建共享编辑器内核
cd equi-win && npm install
npm start                          # 开发运行
```

打包安装包 / 便携版（需 Windows 或已配置的 electron-builder 交叉环境）：

```bash
./scripts/package-windows.sh
# 或仅生成未打包目录：
./scripts/package-windows.sh --dir
```

产物在 `equi-win/dist/`（NSIS 安装包 + portable）。

快捷键与 macOS 对齐（Windows 用 Ctrl）：新建 / 打开 / 保存 / 另存为 / 撤销重做 / 预览缩放。

---

## macOS（原生）

```bash
brew install xcodegen
chmod +x scripts/*.sh
./scripts/package-dmg.sh
```

| 路径 | 说明 |
|------|------|
| `dist/Equi-<version>.dmg` | 拖拽安装盘 |
| `dist/Equi.app` | 可直接运行 |

```bash
./scripts/package-dmg.sh --skip-editor
CONFIGURATION=Debug ./scripts/package-dmg.sh
```

也可在 GitHub Actions 触发 **Package Equi DMG**，或推送 `v*` tag。

> Linux / Cloud Agent 没有 `xcodebuild` / `hdiutil`，无法生成可运行的 macOS DMG。

---

## 目录结构

```
.
├── scripts/
│   ├── build-editor.sh      # 前端 → Equi/Resources + equi-win/resources
│   ├── package-dmg.sh       # macOS DMG
│   └── package-windows.sh   # Windows NSIS / portable
├── Equi/                    # macOS SwiftUI 宿主
├── equi-win/                # Windows Electron 宿主
│   ├── electron/            # main / preload / DocumentModel
│   ├── shell/               # 工具栏 + 状态栏 UI
│   └── resources/           # 构建生成的 EquiEditor.html
└── web-editor/              # 共享 Vite 编辑内核
```

### 仅构建前端

```bash
./scripts/build-editor.sh
```

### Xcode

```bash
brew install xcodegen
xcodegen generate
open Equi.xcodeproj
```

---

## 架构要点

| 模块 | 职责 |
|------|------|
| `web-editor` | 双栏编辑、同步、目录、缩放、右键菜单（两平台共用） |
| macOS `DocumentModel` + `WebViewBridge` | 窗口 / 菜单 / Open·Save / WKWebView |
| Windows `equi-win` | 同等 DocumentModel + Electron webview 桥 |

Bridge 通道名：`editorBridge`（macOS `webkit.messageHandlers`；Windows preload 注入同名 API）。

## 要求

- macOS 13+ / Windows 10+（x64）
- Node.js 20+（构建前端与 Windows 包）
- Xcode 15+（仅 macOS 原生包）

## 许可

见根目录 `LICENSE`。
