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

        // 保持系统标准交通灯位置（不要自定义 trafficLightPosition，除非刻意偏移）
        // fullSizeContentView 下系统仍会将红黄绿放在左上角标准位置。
    }
}

/// 在 SwiftUI 层级挂载时，对宿主 NSWindow 应用 Chrome。
struct WindowChromeConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            WindowChrome.apply(to: view.window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            WindowChrome.apply(to: nsView.window)
        }
    }
}
