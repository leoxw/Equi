# MarkDuo

跨平台双栏 Markdown 编辑器：共享离线 Web 内核（CodeMirror 6 + TipTap），macOS 用 SwiftUI + WKWebView，Windows 用 Electron。

## 功能概览

- 左栏「纯文本」（CodeMirror 6）↔ 右栏「markdown渲染后」（TipTap / ProseMirror）
- 双栏均可折叠；目录导航、预览缩放、右键格式（代码块语言、命名色）
- Tab 分隔表可渲染为表格，且回写不改写源文件中的制表符
- 非 Markdown 文件 → 纯文本单栏；另存为可切换 Markdown / txt / 原格式
- 资源完全离线打包，无外网依赖

---

## Windows（Electron）

```bash
chmod +x scripts/*.sh
./scripts/build-editor.sh          # 构建共享编辑器内核 → macOS Bundle + equi-win/resources
cd equi-win && npm install
npm start                          # 开发运行
```

打包安装包 / 便携版：

```bash
./scripts/package-windows.sh
# 或仅生成未打包目录：
./scripts/package-windows.sh --dir
```

产物在 `equi-win/dist/`（`MarkDuo-*.exe` NSIS / portable）。

快捷键与 macOS 对齐（Windows 用 Ctrl）：新建 / 打开 / 保存 / 另存为 / 撤销重做 / 预览缩放。

---

## macOS（原生）

在 Mac 上执行：

```bash
brew install xcodegen
chmod +x scripts/*.sh
./scripts/package-dmg.sh
```

产物：

| 路径 | 说明 |
|------|------|
| `dist/MarkDuo-<version>.dmg` | 拖拽安装盘（含 Applications 快捷方式） |
| `dist/MarkDuo.app` | 可直接双击运行 |

```bash
./scripts/package-dmg.sh --skip-editor          # 跳过前端重建
CONFIGURATION=Debug ./scripts/package-dmg.sh   # Debug 包
```

也可在 GitHub Actions 中手动触发工作流 **Package MarkDuo DMG**，或推送 `v*` tag 自动出包。

> Linux / Cloud Agent 没有 `xcodebuild` / `hdiutil`，无法在此环境生成可运行的 macOS DMG。

---

## 目录结构

```
.
├── project.yml
├── scripts/
│   ├── build-editor.sh      # 前端 → Equi/Resources/Editor + equi-win/resources
│   ├── package-dmg.sh       # macOS DMG
│   └── package-windows.sh   # Windows NSIS / portable
├── Equi/                    # macOS SwiftUI 宿主（源码目录名保留）
├── equi-win/                # Windows Electron 宿主
└── web-editor/              # 共享 Vite 编辑器内核
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
| `DocumentModel` | 文档 / 路径 / dirty / 字数；Open/Save |
| Bridge | WKWebView / Electron preload → `editorBridge` |
| Sync Engine | `sourceOfTruth` 焦点锁 + debounce + 滚动同步 + Tab 表保留 |

详见 `docs/SYNC_PROTOCOL.md`、`docs/WEBKIT_SECURITY.md`。

## 要求

- macOS 13+ / Windows 10+
- Xcode 15+（仅 macOS 打包）
- Node.js 20+（构建前端 / 打包时）

## 许可

见根目录 `LICENSE`。
