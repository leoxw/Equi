import SwiftUI
import WebKit
import Combine
import AppKit

/// AppKit 宿主：用 view controller 管理 WKWebView，避免 SwiftUI NSViewRepresentable 零尺寸。
final class EditorWebViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    static let bridgeName = "editorBridge"

    var document: DocumentModel
    var commands: EditorCommandBus

    private var webView: WKWebView!
    private var lastPushedRevision: UInt64 = 0
    private var editorDidLoad = false
    private var cancellables = Set<AnyCancellable>()
    private var lastTicket: UInt64 = 0
    private var readyWatchdog: DispatchWorkItem?
    private var didStartLoad = false

    init(document: DocumentModel, commands: EditorCommandBus) {
        self.document = document
        self.commands = commands
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        readyWatchdog?.cancel()
        webView?.configuration.userContentController
            .removeScriptMessageHandler(forName: Self.bridgeName)
    }

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 900, height: 600))
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.textBackgroundColor.cgColor
        self.view = root

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.preferences.isElementFullscreenEnabled = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let userContent = config.userContentController
        userContent.add(self, name: Self.bridgeName)
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

        let wv = WKWebView(frame: root.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.setValue(true, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            wv.underPageBackgroundColor = NSColor.textBackgroundColor
        }
        wv.allowsMagnification = true

        #if DEBUG
        if #available(macOS 13.3, *) {
            wv.isInspectable = true
        }
        #endif

        root.addSubview(wv)
        webView = wv
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        bindCommands()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        // 等宿主给出非零 frame 后再加载，避免首帧空白
        DispatchQueue.main.async { [weak self] in
            guard let self, let webView = self.webView else { return }
            webView.frame = self.view.bounds
            self.loadEditorBundle(into: webView)
        }
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        webView?.frame = view.bounds
    }

    func syncModels(document: DocumentModel, commands: EditorCommandBus) {
        self.document = document
        if self.commands !== commands {
            self.commands = commands
            bindCommands()
        }
        pushNativeContentIfNeeded()
    }

    private func bindCommands() {
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

    private func loadEditorBundle(into webView: WKWebView) {
        guard !didStartLoad else { return }
        didStartLoad = true

        guard let editorDir = Self.resolveEditorDirectory() else {
            let listing = Self.resourceListing()
            showError(
                in: webView,
                title: "Editor Bundle 未找到",
                detail: """
                未找到 <code>Editor/index.html</code>。<br/><br/>
                Bundle Resources：<br/><code>\(Bundle.main.resourcePath ?? "?")</code><br/><br/>
                内容：<br/><pre style="white-space:pre-wrap;font-size:11px">\(listing)</pre>
                <p>请运行 <code>./scripts/bootstrap-xcode.sh</code> 后 Clean + Run。</p>
                """
            )
            return
        }

        let indexURL = editorDir.appendingPathComponent("index.html")
        do {
            var html = try String(contentsOf: indexURL, encoding: .utf8)
            if !html.contains("data-equi-probe") {
                html = html.replacingOccurrences(
                    of: "<body>",
                    with: """
                    <body>
                    <div data-equi-probe="1" style="position:fixed;z-index:99999;left:8px;top:8px;padding:4px 8px;border-radius:6px;font:11px -apple-system;background:#0a7a5c;color:#fff;opacity:.9">Equi WebView OK</div>
                    """
                )
            }
            #if DEBUG
            print("[Equi] loadHTMLString", indexURL.path, "bytes=", html.utf8.count, "bounds=", webView.bounds)
            #endif
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
                    self.evaluate("""
                    window.webkit && window.webkit.messageHandlers &&
                    window.webkit.messageHandlers.editorBridge &&
                    window.webkit.messageHandlers.editorBridge.postMessage({type:'ready'})
                    """)
                    return
                }
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
                    HTML 已注入，但 <code>EditorAPI</code> 未就绪。<br/>
                    index.html：<code>\(indexSize)</code>（内联后应 &gt; 500KB）<br/>
                    WebView bounds：<code>\(Int(webView.bounds.width))×\(Int(webView.bounds.height))</code><br/>
                    路径：<code>\(editorDir.path)</code><br/><br/>
                    若仍全黑：确认 entitlements 已开启 <code>com.apple.security.network.client</code>，
                    然后 Clean Build Folder 再 Run。
                    """
                )
            }
        }
        readyWatchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: work)
    }

    private static func resolveEditorDirectory() -> URL? {
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Editor") {
            return url.deletingLastPathComponent()
        }
        if let res = Bundle.main.resourceURL {
            let dir = res.appendingPathComponent("Editor")
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path) {
                return dir
            }
        }
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            return url.deletingLastPathComponent()
        }
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
        let items = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        var lines = [root.path]
        for name in items.sorted().prefix(50) {
            lines.append("• " + name)
        }
        return lines.joined(separator: "\n")
    }

    private func showError(in webView: WKWebView, title: String, detail: String) {
        let html = """
        <html><head><meta charset="utf-8"><style>
        body{font:13px -apple-system;padding:28px;line-height:1.5;color:#222;background:#f3f1ec}
        @media(prefers-color-scheme:dark){body{color:#eee;background:#1c1c1e}}
        code,pre{background:rgba(127,127,127,.18);padding:2px 5px;border-radius:4px}
        h2{margin:0 0 12px;color:#c0392b}
        </style></head>
        <body><h2>\(title)</h2><div>\(detail)</div></body></html>
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

/// SwiftUI 包装：NSViewControllerRepresentable 在 macOS 上对 WKWebView 更稳。
struct WebViewBridge: NSViewControllerRepresentable {
    @ObservedObject var document: DocumentModel
    @ObservedObject var commands: EditorCommandBus

    func makeNSViewController(context: Context) -> EditorWebViewController {
        EditorWebViewController(document: document, commands: commands)
    }

    func updateNSViewController(_ controller: EditorWebViewController, context: Context) {
        controller.syncModels(document: document, commands: commands)
    }
}
