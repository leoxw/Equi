import SwiftUI
import AppKit

/// 把标题绑到「承载本视图的那扇 NSWindow」上，避免误改 keyWindow（多标签时会串台）。
struct WindowTitleBinder: NSViewRepresentable {
    let title: String
    let representedURL: URL?

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        view.isHidden = true
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        // 能立刻绑上就立刻绑：多标签下靠 representedURL 判断「是否已打开」
        if let window = nsView.window {
            apply(to: window)
            return
        }
        // 尚未挂到 window 时再等一拍
        DispatchQueue.main.async {
            guard let window = nsView.window else { return }
            self.apply(to: window)
        }
    }

    private func apply(to window: NSWindow) {
        if window.title != title {
            window.title = title
        }
        if window.representedURL != representedURL {
            window.representedURL = representedURL
        }
        DocumentWindowTabbing.apply(to: window)
    }
}
