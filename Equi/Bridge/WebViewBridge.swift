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
                      type: 'log', message: 'JSError: ' + msg + ' @' + src + ':' + line
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
        /// 必须与 web-editor/src/bridge.js 的 HANDLER 一致
        static let bridgeName = "editorBridge"

        var document: DocumentModel
        var commands: EditorCommandBus
        weak var webView: WKWebView?

        private var lastPushedRevision: UInt64 = 0
        private var editorDidLoad = false
        private var cancellables = Set<AnyCancellable>()
        private var lastTicket: UInt64 = 0

        init(document: DocumentModel, commands: EditorCommandBus) {
            self.document = document
            self.commands = commands
        }

        deinit {
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

        func loadEditorBundle(into webView: WKWebView) {
            let candidates: [URL?] = [
                Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor"),
                Bundle.main.resourceURL?.appendingPathComponent("Editor/index.html"),
                Bundle.main.url(forResource: "index", withExtension: "html"),
                URL(fileURLWithPath: #file)
                    .deletingLastPathComponent()
                    .deletingLastPathComponent()
                    .appendingPathComponent("Resources/Editor/index.html")
            ]

            for case let url? in candidates where FileManager.default.fileExists(atPath: url.path) {
                #if DEBUG
                print("[Equi] Loading editor:", url.path)
                #endif
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
                return
            }

            showError(in: webView, title: "Editor Bundle 未找到", detail: """
            未找到 Editor/index.html。<br/>
            请确认 <code>Equi/Resources/Editor</code> 为蓝色 Folder Reference，并勾选 Target。
            """)
        }

        private func showError(in webView: WKWebView, title: String, detail: String) {
            let html = """
            <html><head><meta charset="utf-8"><style>
            body{font:13px -apple-system;padding:32px;color:#333;background:#f4f3f0}
            @media(prefers-color-scheme:dark){body{color:#eee;background:#1c1c1e}}
            code{background:rgba(127,127,127,.2);padding:1px 4px;border-radius:3px}
            </style></head><body><h2>\(title)</h2><p>\(detail)</p></body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }

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

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == Self.bridgeName,
                  let body = message.body as? [String: Any] else { return }
            let type = body["type"] as? String ?? ""

            Task { @MainActor in
                switch type {
                case "ready":
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
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL || url.absoluteString.hasPrefix("about:") {
                decisionHandler(.allow); return
            }
            if navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("typeof window.EditorAPI") { result, _ in
                let ok = (result as? String) == "object"
                if !ok && !self.editorDidLoad {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        guard !self.editorDidLoad else { return }
                        self.showError(in: webView, title: "编辑器脚本未启动", detail: """
                        HTML 已加载，但 <code>EditorAPI</code> 未就绪（常见于 file:// 无法跑 ES Module）。<br/>
                        请 <code>git pull</code> 后执行 <code>./scripts/build-editor.sh</code>，再重新 Run / 打包。
                        """)
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, title: "页面加载失败", detail: error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showError(in: webView, title: "页面加载失败", detail: error.localizedDescription)
        }
    }
}
