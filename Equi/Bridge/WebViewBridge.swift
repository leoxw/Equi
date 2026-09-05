import SwiftUI
import WebKit
import Combine
import AppKit

/// JS ↔ Swift 双向桥接：封装 WKWebView，加载本地 Editor Bundle。
struct WebViewBridge: NSViewRepresentable {

    @ObservedObject var document: DocumentModel
    @ObservedObject var commands: EditorCommandBus

    func makeCoordinator() -> Coordinator {
        Coordinator(document: document, commands: commands)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // 本地 file 互访（KVC）；内联 HTML 为主路径，这两项作兜底
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.preferences.isElementFullscreenEnabled = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let userContent = config.userContentController
        userContent.add(context.coordinator, name: Coordinator.bridgeName)
        userContent.addUserScript(
            WKUserScript(
                source: """
                window.__EQUI_EDITOR__ = { platform: 'macos', app: 'Equi', bridgeReady: true };
                window.onerror = function(msg, src, line) {
                  try {
                    window.webkit.messageHandlers.editorBridge.postMessage({
                      type: 'log', message: 'JSError: ' + msg + ' @' + (src||'') + ':' + line
                    });
                  } catch (e) {}
                };
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.setValue(true, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = NSColor.textBackgroundColor
        }
        webView.allowsMagnification = true
        webView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        webView.setContentHuggingPriority(.defaultLow, for: .vertical)
        webView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        webView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)

        #if DEBUG
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif

        context.coordinator.webView = webView
        context.coordinator.bindCommands()
        context.coordinator.loadEditorBundle(into: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.document = document
        context.coordinator.commands = commands
        context.coordinator.pushNativeContentIfNeeded()
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        static let bridgeName = "editorBridge"

        var document: DocumentModel
        var commands: EditorCommandBus
        weak var webView: WKWebView?

        private var lastPushedRevision: UInt64 = 0
        private var editorDidLoad = false
        private var cancellables = Set<AnyCancellable>()
        private var lastTicket: UInt64 = 0
        private var readyWatchdog: DispatchWorkItem?

        init(document: DocumentModel, commands: EditorCommandBus) {
            self.document = document
            self.commands = commands
        }

        deinit {
            readyWatchdog?.cancel()
            webView?.configuration.userContentController
                .removeScriptMessageHandler(forName: Self.bridgeName)
        }

        func bindCommands() {
            cancellables.removeAll()
            commands.$ticket
                .compactMap { $0 }
                .receive(on: DispatchQueue.main)
                .sink { [weak self] ticket, command in
                    guard let self, ticket != self.lastTicket else { return }
                    self.lastTicket = ticket
                    self.handle(command)
                }
                .store(in: &cancellables)
        }

        private func handle(_ command: EditorCommandBus.Command) {
            switch command {
            case .undo: evaluate("window.EditorAPI && window.EditorAPI.undo()")
            case .redo: evaluate("window.EditorAPI && window.EditorAPI.redo()")
            case .focusSource: evaluate("window.EditorAPI && window.EditorAPI.focusPane('source')")
            case .focusWysiwyg: evaluate("window.EditorAPI && window.EditorAPI.focusPane('wysiwyg')")
            }
        }

        // MARK: Load — 优先把内联 index.html 读成字符串注入（避开 file:// 外链脚本坑）

        func loadEditorBundle(into webView: WKWebView) {
            guard let editorDir = Self.resolveEditorDirectory() else {
                let listing = Self.resourceListing()
                showError(
                    in: webView,
                    title: "Editor Bundle 未找到",
                    detail: """
                    未找到 <code>Editor/index.html</code>。<br/><br/>
                    Bundle Resources 目录：<br/><code>\(Bundle.main.resourcePath ?? "?")</code><br/><br/>
                    内容列表：<br/><pre style="white-space:pre-wrap;font-size:11px">\(listing)</pre>
                    <p>请确认 Xcode 中 <code>Equi/Resources/Editor</code> 为蓝色 Folder Reference，并勾选 Target Membership。</p>
                    """
                )
                return
            }

            let indexURL = editorDir.appendingPathComponent("index.html")
            do {
                let html = try String(contentsOf: indexURL, encoding: .utf8)
                #if DEBUG
                print("[Equi] loadHTMLString from", indexURL.path, "bytes=", html.utf8.count)
                #endif
                // baseURL 指向 Editor 目录；即便有相对资源也能解析
                webView.loadHTMLString(html, baseURL: editorDir)
                startReadyWatchdog(on: webView, editorDir: editorDir)
            } catch {
                showError(in: webView, title: "无法读取 index.html", detail: error.localizedDescription)
            }
        }

        private func startReadyWatchdog(on webView: WKWebView, editorDir: URL) {
            readyWatchdog?.cancel()
            let work = DispatchWorkItem { [weak self, weak webView] in
                guard let self, let webView, !self.editorDidLoad else { return }
                webView.evaluateJavaScript("typeof window.EditorAPI") { result, _ in
                    let ready = (result as? String) == "object"
                    if ready {
                        // JS 在跑但没发 ready：手动补发
                        self.evaluate("window.EditorAPI && window.webkit.messageHandlers.editorBridge.postMessage({type:'ready'})")
                        return
                    }
                    let jsURL = editorDir.appendingPathComponent("assets/editor.js")
                    let jsExists = FileManager.default.fileExists(atPath: jsURL.path)
                    let indexSize: String = {
                        let u = editorDir.appendingPathComponent("index.html")
                        guard let attrs = try? FileManager.default.attributesOfItem(atPath: u.path),
                              let size = attrs[.size] as? NSNumber else { return "?" }
                        return "\(size.intValue) bytes"
                    }()
                    self.showError(
                        in: webView,
                        title: "编辑器脚本未启动",
                        detail: """
                        HTML 已注入，但 <code>EditorAPI</code> 仍未就绪。<br/>
                        index.html 大小：<code>\(indexSize)</code>（内联后应 &gt; 500KB）<br/>
                        assets/editor.js 存在：<code>\(jsExists)</code><br/>
                        Editor 路径：<code>\(editorDir.path)</code><br/><br/>
                        请执行：<code>git pull && ./scripts/build-editor.sh</code> 后重新 Run。
                        """
                    )
                }
            }
            readyWatchdog = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: work)
        }

        private static func resolveEditorDirectory() -> URL? {
            // 1) Bundle/Editor/
            if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor") {
                return url.deletingLastPathComponent()
            }
            if let res = Bundle.main.resourceURL {
                let dir = res.appendingPathComponent("Editor")
                if FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path) {
                    return dir
                }
            }
            // 2) 扁平：Resources/index.html
            if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
                return url.deletingLastPathComponent()
            }
            // 3) 开发态源码树
            let dev = URL(fileURLWithPath: #file)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Resources/Editor")
            if FileManager.default.fileExists(atPath: dev.appendingPathComponent("index.html").path) {
                return dev
            }
            return nil
        }

        private static func resourceListing() -> String {
            guard let root = Bundle.main.resourceURL else { return "(no resourceURL)" }
            let fm = FileManager.default
            let items = (try? fm.contentsOfDirectory(atPath: root.path)) ?? []
            var lines: [String] = [root.path]
            for name in items.sorted().prefix(40) {
                let p = root.appendingPathComponent(name)
                var isDir: ObjCBool = false
                fm.fileExists(atPath: p.path, isDirectory: &isDir)
                lines.append((isDir.boolValue ? "📁 " : "📄 ") + name)
            }
            return lines.joined(separator: "\n")
        }

        private func showError(in webView: WKWebView, title: String, detail: String) {
            let html = """
            <html><head><meta charset="utf-8"><style>
            body{font:13px -apple-system;padding:28px;line-height:1.5;
              color:#222;background:#f3f1ec}
            @media(prefers-color-scheme:dark){body{color:#eee;background:#1c1c1e}}
            code,pre{background:rgba(127,127,127,.18);padding:2px 5px;border-radius:4px}
            h2{margin:0 0 12px;color:#c0392b}
            </style></head>
            <body><h2>\(title)</h2><div>\(detail)</div></body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }

        // MARK: Swift → JS

        func pushNativeContentIfNeeded() {
            guard editorDidLoad else { return }
            let rev = document.nativeRevision
            guard rev != lastPushedRevision else { return }
            lastPushedRevision = rev
            let payload: [String: Any] = [
                "markdown": document.content,
                "revision": rev,
                "markClean": !document.isDirty
            ]
            evaluateCall("window.EditorAPI && window.EditorAPI.setMarkdown", payload: payload)
        }

        private func evaluate(_ js: String) {
            webView?.evaluateJavaScript(js) { _, error in
                #if DEBUG
                if let error { print("[WebViewBridge]", error) }
                #endif
            }
        }

        private func evaluateCall(_ fn: String, payload: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            evaluate("\(fn)(\(json))")
        }

        // MARK: JS → Swift

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == Self.bridgeName,
                  let body = message.body as? [String: Any] else { return }
            let type = body["type"] as? String ?? ""

            Task { @MainActor in
                switch type {
                case "ready":
                    self.readyWatchdog?.cancel()
                    self.editorDidLoad = true
                    self.document.isEditorReady = true
                    self.lastPushedRevision = 0
                    if self.document.content.isEmpty {
                        let welcome = """
                        # Equi

                        左侧编辑 **原始 Markdown**，右侧进行所见即所得排版。

                        - 焦点在左：源码 → 富文本
                        - 焦点在右：富文本 → 源码
                        - 拖拽中间分隔条可调宽度

                        ```js
                        console.log('离线 Bundle');
                        ```
                        """
                        self.document.replaceContent(welcome, markingClean: true)
                    }
                    self.pushNativeContentIfNeeded()

                case "contentChange", "contentChanged":
                    self.document.applyWebUpdate(
                        markdown: body["markdown"] as? String ?? "",
                        dirty: body["dirty"] as? Bool ?? true,
                        words: body["wordCount"] as? Int ?? 0,
                        characters: body["characterCount"] as? Int ?? 0
                    )

                case "dirty":
                    if let dirty = body["dirty"] as? Bool { self.document.isDirty = dirty }

                case "log":
                    print("[Editor]", body["message"] as? String ?? String(describing: body))

                default: break
                }
            }
        }

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
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, title: "页面加载失败", detail: error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, title: "页面加载失败", detail: error.localizedDescription)
        }
    }
}
