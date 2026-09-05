import SwiftUI
import WebKit
import Combine

/// JS ↔ Swift 双向桥接：封装 WKWebView，加载本地 Editor Bundle，并转发消息。
struct WebViewBridge: NSViewRepresentable {

    @ObservedObject var document: DocumentModel
    @ObservedObject var commands: EditorCommandBus

    func makeCoordinator() -> Coordinator {
        Coordinator(document: document, commands: commands)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // —— 本地 file:// 资源互访（KVC 私有偏好，App Store 需自行评估风险）——
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")

        config.preferences.isElementFullscreenEnabled = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let userContent = config.userContentController
        userContent.add(context.coordinator, name: Coordinator.bridgeName)

        let bootstrap = WKUserScript(
            source: """
            window.__EQUI_EDITOR__ = {
              platform: 'macos',
              app: 'Equi',
              bridgeReady: true
            };
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        userContent.addUserScript(bootstrap)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = true

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

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {

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
            super.init()
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
            case .undo:
                evaluate("window.EditorAPI && window.EditorAPI.undo()")
            case .redo:
                evaluate("window.EditorAPI && window.EditorAPI.redo()")
            case .focusSource:
                evaluate("window.EditorAPI && window.EditorAPI.focusPane('source')")
            case .focusWysiwyg:
                evaluate("window.EditorAPI && window.EditorAPI.focusPane('wysiwyg')")
            }
        }

        // MARK: Load local bundle

        func loadEditorBundle(into webView: WKWebView) {
            if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor") {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
                return
            }
            if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
                return
            }

            let devPath = URL(fileURLWithPath: #file)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Resources/Editor/index.html")
            if FileManager.default.fileExists(atPath: devPath.path) {
                webView.loadFileURL(devPath, allowingReadAccessTo: devPath.deletingLastPathComponent())
                return
            }

            let html = """
            <html><body style="font-family:-apple-system;padding:40px;color:#888">
            <h2>Editor Bundle 未找到</h2>
            <p>请确认 Resources/Editor/index.html 已加入 Copy Bundle Resources。</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }

        // MARK: Swift → JS

        func pushNativeContentIfNeeded() {
            guard editorDidLoad else { return }
            let rev = document.nativeRevision
            guard rev != lastPushedRevision else { return }
            lastPushedRevision = rev
            setMarkdown(document.content, revision: rev, markClean: !document.isDirty)
        }

        func setMarkdown(_ markdown: String, revision: UInt64, markClean: Bool) {
            let payload: [String: Any] = [
                "markdown": markdown,
                "revision": revision,
                "markClean": markClean
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

        private func evaluateCall(_ fnExpr: String, payload: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            evaluate("\(fnExpr)(\(json))")
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
                    self.editorDidLoad = true
                    self.document.isEditorReady = true
                    self.lastPushedRevision = 0
                    self.pushNativeContentIfNeeded()

                case "contentChange":
                    self.document.applyWebUpdate(
                        markdown: body["markdown"] as? String ?? "",
                        dirty: body["dirty"] as? Bool ?? true,
                        words: body["wordCount"] as? Int ?? 0,
                        characters: body["characterCount"] as? Int ?? 0
                    )

                case "dirty":
                    if let dirty = body["dirty"] as? Bool {
                        self.document.isDirty = dirty
                    }

                case "log":
                    #if DEBUG
                    print("[Editor]", body["message"] as? String ?? String(describing: body))
                    #endif

                default:
                    break
                }
            }
        }

        // MARK: Navigation — 禁止外网，外链走系统浏览器

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if url.isFileURL || url.absoluteString.hasPrefix("about:") {
                decisionHandler(.allow)
                return
            }
            if navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }
}
