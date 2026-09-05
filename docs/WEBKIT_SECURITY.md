# WebKit 本地 Editor Bundle 安全策略

WKWebView 默认对 `file://` 页面的同源与子资源访问较严格。本应用把整个编辑器打成 App Bundle 内的静态目录，需要显式放宽「本地文件互访」，同时用 CSP + 导航策略锁死外网。

## 1. 加载方式（推荐）

```swift
let index = Bundle.main.url(
    forResource: "index",
    withExtension: "html",
    subdirectory: "Editor"
)!
let accessRoot = index.deletingLastPathComponent() // …/Editor

webView.loadFileURL(index, allowingReadAccessTo: accessRoot)
```

`allowingReadAccessTo` 决定页面能 `fetch` / `<script src>` / `<link href>` 读取的目录上界。务必指向 `Editor/`，而不是整个 `Resources/` 或用户家目录。

> **Xcode 注意**：`Editor` 必须作为 **Folder Reference（蓝色文件夹）** 拷贝进 Bundle，子路径 `assets/editor.js` 才会保留。若用 Group（黄色），文件可能被拍平成 `Resources/index.html`，相对路径会断。

## 2. KVC 偏好（关键但常用）

```swift
let config = WKWebViewConfiguration()

// 允许 file:// 页面访问其他本地文件 URL（脚本、样式、worker 等）
config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

// 允许 file:// 获得更宽松的通用访问（跨本地路径）；权衡见下
config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
```

| Key | 作用 | 风险 |
|-----|------|------|
| `allowFileAccessFromFileURLs` | `file://` 文档可加载同树其他 `file://` 资源 | 若 HTML 被注入恶意路径，可能读到 `allowingReadAccessTo` 范围内文件 |
| `allowUniversalAccessFromFileURLs` | 进一步放宽本地通用访问 | 同上；App Store 审核一般可接受，但属于非公开 API 的 KVC |

二者都是 WebKit 内部偏好，通过 KVC 设置；不是 App Store 禁止的私有 **符号** 链接，但属于未文档化行为。上架前建议用最新 Xcode 实机验证，并尽量收窄 `allowingReadAccessTo`。

## 3. 与 App 沙盒配合

本仓库 Entitlements：

- `com.apple.security.app-sandbox = true`
- `com.apple.security.files.user-selected.read-write = true`（Open/Save Panel）
- `com.apple.security.network.client = true`（**必需**：沙盒下 WKWebView 依赖 WebContent 进程 IPC；关闭时常见「工具栏正常、中间全黑」。App 本身仍不主动出网，CSP/`connect-src` 也保持收紧）

用户 Markdown 文件通过 `NSOpenPanel` / `NSSavePanel` 获得 security-scoped 访问；**不要**把用户文档目录传给 `allowingReadAccessTo`。

## 4. 内容安全策略（CSP）

`index.html` 内：

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'none';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none'
```

即使 WebKit 偏好被放宽，CSP 仍禁止：

- 加载 CDN / 任意 https 脚本
- `fetch` / XHR / WebSocket 外连
- 嵌套 iframe、插件

`style-src 'unsafe-inline'`：CodeMirror / TipTap 运行时可能注入少量 inline style；若你改为纯外链 CSS，可去掉该项。

## 5. 导航代理（第二道闸）

```swift
func webView(_ webView: WKWebView,
             decidePolicyFor navigationAction: WKNavigationAction,
             decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url else {
        decisionHandler(.cancel); return
    }
    if url.isFileURL || url.absoluteString.hasPrefix("about:") {
        decisionHandler(.allow); return
    }
    if navigationAction.navigationType == .linkActivated {
        NSWorkspace.shared.open(url) // 外链交给系统浏览器
    }
    decisionHandler(.cancel)
}
```

## 6. 消息通道安全

仅注册具名 handler：

```swift
userContentController.add(coordinator, name: "editorBridge")
```

JS 侧只通过 `window.webkit.messageHandlers.editorBridge.postMessage` 上报；Swift 侧对 `type` 做白名单分发（`ready` / `contentChange` / `dirty` / `log`）。不要 `evaluateJavaScript` 拼接未转义的用户 Markdown（本项目用 `JSONSerialization` 生成参数）。

## 7. 调试

- macOS 13.3+：`webView.isInspectable = true`（DEBUG）
- Safari → 开发 → 可检查 WKWebView
- 开发期若 Bundle 内找不到 HTML，`WebViewBridge` 会回退到源码相对路径 `Resources/Editor/index.html`

## 8. 清单（上线前自检）

- [ ] `Editor/` 为 Folder Reference，运行时 `Bundle.main.url(…subdirectory: "Editor")` 非 nil
- [ ] `allowingReadAccessTo` 仅覆盖 Editor 目录
- [ ] CSP `connect-src 'none'`，导航代理拒绝非 file/about
- [ ] Entitlements 未打开不必要的网络 / 宽文件权限
- [ ] 用户文档只经 Open/Save Panel + security-scoped API 读写
