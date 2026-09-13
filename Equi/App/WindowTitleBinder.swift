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
        // 等一拍，确保 SwiftUI 已把 view 挂到 window 上
        DispatchQueue.main.async {
            guard let window = nsView.window else { return }
            if window.title != title {
                window.title = title
            }
            if window.representedURL != representedURL {
                window.representedURL = representedURL
            }
        }
    }
}
