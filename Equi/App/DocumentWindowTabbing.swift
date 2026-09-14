import AppKit
import SwiftUI

/// 将 SwiftUI `openWindow` 创建的文档窗并入系统标签页，并支持「已打开则跳转」。
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

    /// 若该文件已在某个文档标签中打开，则切到该标签并返回 `true`。
    @discardableResult
    static func focusIfAlreadyOpen(_ url: URL) -> Bool {
        let target = normalizedPath(url)
        guard !target.isEmpty else { return false }
        for window in NSApp.windows where isDocumentWindow(window) {
            guard let opened = window.representedURL else { continue }
            if normalizedPath(opened) == target {
                activate(window)
                return true
            }
        }
        return false
    }

    /// 打开新文档标签，并在建窗后切换到新生标签（而不是留在旧标签）。
    static func openTab(
        using openWindow: OpenWindowAction,
        host: NSWindow? = NSApp.keyWindow
    ) {
        let anchor = host ?? NSApp.mainWindow ?? NSApp.windows.first(where: isDocumentWindow)
        apply(to: anchor)
        let priorIDs = Set(NSApp.windows.filter(isDocumentWindow).map { ObjectIdentifier($0) })
        openWindow(id: "document")
        // SwiftUI 建窗是异步的，Chrome / tabbingIdentifier 也可能稍后才挂上；多拍合并并聚焦新标签
        for delay in [0.0, 0.05, 0.12, 0.28, 0.5] as [TimeInterval] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                coalesce(into: anchor, focusingNewRelativeTo: priorIDs)
            }
        }
    }

    /// 把尚未入组的文档窗并入同一标签栏；优先激活新生窗。
    static func coalesce(
        into preferredHost: NSWindow? = nil,
        focusingNewRelativeTo priorIDs: Set<ObjectIdentifier>? = nil
    ) {
        let docs = NSApp.windows.filter(isDocumentWindow)
        guard !docs.isEmpty else { return }

        if docs.count == 1 {
            apply(to: docs[0])
            if priorIDs != nil {
                activate(docs[0])
            }
            return
        }

        let host =
            preferredHost.flatMap { docs.contains($0) ? $0 : nil }
            ?? docs.first(where: { $0.isKeyWindow })
            ?? docs.first(where: { ($0.tabbedWindows?.count ?? 0) > 1 })
            ?? docs[0]

        apply(to: host)
        var newest: NSWindow?
        for window in docs where window !== host {
            apply(to: window)
            if isAlreadyTabbed(with: host, window: window) {
                if let priorIDs, !priorIDs.contains(ObjectIdentifier(window)) {
                    newest = window
                }
                continue
            }
            // 已在其它标签组里则先不管，避免来回拆合
            if let tabs = window.tabbedWindows, tabs.count > 1, !tabs.contains(host) {
                continue
            }
            host.addTabbedWindow(window, ordered: .above)
            if let priorIDs, !priorIDs.contains(ObjectIdentifier(window)) {
                newest = window
            } else if priorIDs == nil {
                newest = window
            }
        }

        activate(newest ?? host)
    }

    static func activate(_ window: NSWindow) {
        // makeKeyAndOrderFront 会选中该窗在标签组中的对应标签
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private static func normalizedPath(_ url: URL) -> String {
        url.standardizedFileURL.path
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
