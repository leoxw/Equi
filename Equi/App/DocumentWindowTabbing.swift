import AppKit
import SwiftUI

/// 将 SwiftUI `openWindow` 创建的文档窗并入系统标签页，而不是散落成多个独立窗口。
enum DocumentWindowTabbing {
    static let identifier = "com.leoxw.MarkDuo.document"

    /// 本 App 内强制「打开文稿时使用标签页」（覆盖系统“仅全屏”等偏好对本进程的影响）。
    static func preferTabsForThisApp() {
        UserDefaults.standard.set("always", forKey: "AppleWindowTabbingMode")
    }

    static func apply(to window: NSWindow?) {
        guard let window else { return }
        window.tabbingMode = .preferred
        window.tabbingIdentifier = identifier
    }

    /// 打开新文档场景，并尽量把新生窗并入 `host` 的标签组。
    static func openTab(
        using openWindow: OpenWindowAction,
        host: NSWindow? = NSApp.keyWindow
    ) {
        let anchor = host ?? NSApp.mainWindow ?? NSApp.windows.first(where: isDocumentWindow)
        apply(to: anchor)
        openWindow(id: "document")
        // SwiftUI 建窗是异步的，Chrome / tabbingIdentifier 也可能稍后才挂上；多拍合并
        for delay in [0.0, 0.05, 0.12, 0.28] as [TimeInterval] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                coalesce(into: anchor)
            }
        }
    }

    /// 把尚未入组的文档窗并入同一标签栏。
    static func coalesce(into preferredHost: NSWindow? = nil) {
        let docs = NSApp.windows.filter(isDocumentWindow)
        guard docs.count >= 2 else {
            docs.forEach { apply(to: $0) }
            return
        }

        let host =
            preferredHost.flatMap { docs.contains($0) ? $0 : nil }
            ?? docs.first(where: { $0.isKeyWindow })
            ?? docs.first(where: { ($0.tabbedWindows?.count ?? 0) > 1 })
            ?? docs[0]

        apply(to: host)
        for window in docs where window !== host {
            apply(to: window)
            if isAlreadyTabbed(with: host, window: window) { continue }
            // 已在其它标签组里则先不管，避免来回拆合
            if let tabs = window.tabbedWindows, tabs.count > 1, !tabs.contains(host) {
                continue
            }
            host.addTabbedWindow(window, ordered: .above)
        }
        host.makeKeyAndOrderFront(nil)
    }

    private static func isDocumentWindow(_ window: NSWindow) -> Bool {
        if window is NSPanel { return false }
        guard window.styleMask.contains(.titled) else { return false }
        if window.tabbingIdentifier == identifier { return true }
        // Chrome 尚未挂上时：普通可调整大小的 App 主窗也算文档窗
        return window.styleMask.contains(.resizable)
            && window.contentView != nil
            && window.frame.width >= 400
    }

    private static func isAlreadyTabbed(with host: NSWindow, window: NSWindow) -> Bool {
        if host.tabbedWindows?.contains(window) == true { return true }
        if window.tabbedWindows?.contains(host) == true { return true }
        return false
    }
}
