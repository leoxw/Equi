import SwiftUI
import AppKit

/// 窗口毛玻璃 / 透明标题栏配置。
enum WindowChrome {
    /// 应用到当前 key window（或指定 window）的标准编辑器外观。
    static func apply(to window: NSWindow?) {
        guard let window else { return }

        window.titlebarAppearsTransparent = true
        window.titleVisibility = .visible
        window.styleMask.insert(.fullSizeContentView)
        window.isMovableByWindowBackground = false

        // 统一工具栏风格（macOS Big Sur+）
        window.toolbarStyle = .unified
        window.titlebarSeparatorStyle = .automatic

        // 半透明背景：内容延伸到标题栏下方
        window.backgroundColor = NSColor.windowBackgroundColor

        DocumentWindowTabbing.apply(to: window)
    }
}

/// 在窗口附着时立刻设置 tabbing，避免 openWindow 后先成独立窗、再改 mode 来不及并入标签。
private final class WindowChromeNSView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        WindowChrome.apply(to: window)
    }

    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()
        WindowChrome.apply(to: window)
    }
}

/// 在 SwiftUI 层级挂载时，对宿主 NSWindow 应用 Chrome。
struct WindowChromeConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        WindowChromeNSView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        WindowChrome.apply(to: nsView.window)
    }
}
