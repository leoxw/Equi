# Equi

macOS 独占的原生双栏 Markdown 编辑器：SwiftUI + AppKit 外壳，WKWebView 内嵌离线 Web 编辑内核（CodeMirror 6 + TipTap）。

## 功能概览

- 毛玻璃 / 透明标题栏（`titlebarAppearsTransparent` + `fullSizeContentView`）
- 标准红绿灯位置与 ⌘O / ⌘S / ⌘⇧S / ⌘Z 等系统快捷键
- 左栏 Raw Markdown（CodeMirror 6）↔ 右栏 WYSIWYG（TipTap / ProseMirror）
- 分栏拖拽、焦点驱动的双向同步锁、防抖、滚动百分比同步
- 资源完全离线打包，无外网依赖

---

## 本地打包 DMG（macOS）

在 Mac 上执行：

```bash
brew install xcodegen
chmod +x scripts/*.sh
./scripts/package-dmg.sh
```

产物：

| 路径 | 说明 |
|------|------|
| `dist/Equi-<version>.dmg` | 拖拽安装盘（含 Applications 快捷方式） |
| `dist/Equi.app` | 可直接双击运行 |

```bash
./scripts/package-dmg.sh --skip-editor          # 跳过前端重建
CONFIGURATION=Debug ./scripts/package-dmg.sh   # Debug 包
```

也可在 GitHub Actions 中手动触发工作流 **Package Equi DMG**，或推送 `v*` tag 自动出包。

> Linux / Cloud Agent 没有 `xcodebuild` / `hdiutil`，无法在此环境生成可运行的 macOS DMG。

---

## 目录结构

```
.
├── project.yml
├── scripts/
│   ├── build-editor.sh      # 前端 → Equi/Resources/Editor
│   └── package-dmg.sh       # xcodebuild + hdiutil → dist/*.dmg
├── Equi/
│   ├── App/
│   │   ├── EquiApp.swift
│   │   └── WindowChrome.swift
│   ├── Models/DocumentModel.swift
│   ├── Bridge/
│   ├── Views/ContentView.swift
│   ├── Resources/Editor/    # 离线 Web Bundle（打进 App）
│   └── Supporting/
│       ├── Info.plist
│       └── Equi.entitlements
└── web-editor/              # Vite 源码
```

### Xcode

```bash
brew install xcodegen
xcodegen generate
open Equi.xcodeproj
```

`Equi/Resources/Editor` 须以 **Folder Reference（蓝色文件夹）** 加入 Copy Bundle Resources。

### 仅构建前端

```bash
./scripts/build-editor.sh
```

---

## 架构要点

| 模块 | 职责 |
|------|------|
| `DocumentModel` | 文档 / 路径 / dirty / 字数；Open/Save Panel |
| `WebViewBridge` | WKWebView、本地 Bundle、`editorBridge` |
| `EditorCommandBus` | 菜单 / 工具栏 → undo/redo/focus |
| Sync Engine | `sourceOfTruth` 焦点锁 + debounce + 滚动同步 |

详见 `docs/SYNC_PROTOCOL.md`、`docs/WEBKIT_SECURITY.md`。

## 要求

- macOS 13+
- Xcode 15+
- Node.js 20+（构建前端 / 打 DMG 时）

## 许可

见根目录 `LICENSE`。
