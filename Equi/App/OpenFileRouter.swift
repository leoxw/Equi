import Foundation
import AppKit
import Combine

/// 接收 Finder「打开方式」/ 双击传入的文件 URL，再交给窗口里的 DocumentModel。
@MainActor
final class OpenFileRouter: ObservableObject {
    static let shared = OpenFileRouter()
    static let requestNewWindow = Notification.Name("equi.requestNewWindow")

    private(set) var pendingURLs: [URL] = []
    @Published private(set) var epoch: UInt64 = 0

    private var newWindowScheduled = false
    private var newWindowClaimed = false
    /// 短时去重，避免 argv 与 `application(_:open:)` 重复入队同一文件。
    private var recentPathKeys: [String: Date] = [:]

    private init() {}

    var hasPending: Bool { !pendingURLs.isEmpty }

    func enqueue(_ urls: [URL]) {
        let now = Date()
        pruneRecent(now: now)

        var added: [URL] = []
        for url in urls where url.isFileURL {
            let standardized = url.standardizedFileURL
            let key = standardized.path
            if let last = recentPathKeys[key], now.timeIntervalSince(last) < 2 {
                continue
            }
            if pendingURLs.contains(where: { $0.standardizedFileURL.path == key }) {
                continue
            }
            recentPathKeys[key] = now
            added.append(standardized)
        }
        guard !added.isEmpty else { return }

        pendingURLs.append(contentsOf: added)
        epoch &+= 1
        NSApp.activate(ignoringOtherApps: true)
        scheduleNewWindowIfStillPending()
    }

    func dequeue() -> URL? {
        guard !pendingURLs.isEmpty else { return nil }
        return pendingURLs.removeFirst()
    }

    /// 多窗口同时收到通知时，只允许一扇窗去 openWindow。
    func claimNewWindow() -> Bool {
        guard hasPending, !newWindowClaimed else { return false }
        newWindowClaimed = true
        DispatchQueue.main.async { [weak self] in
            self?.newWindowClaimed = false
        }
        return true
    }

    private func pruneRecent(now: Date) {
        recentPathKeys = recentPathKeys.filter { now.timeIntervalSince($0.value) < 2 }
    }

    private func scheduleNewWindowIfStillPending() {
        guard !newWindowScheduled else { return }
        newWindowScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self else { return }
            self.newWindowScheduled = false
            if self.hasPending {
                NotificationCenter.default.post(name: Self.requestNewWindow, object: nil)
            }
        }
    }
}

/// 桥接 Finder / Launch Services。AppKit 回调在主线程。
final class EquiAppDelegate: NSObject, NSApplicationDelegate {
    func application(_ application: NSApplication, open urls: [URL]) {
        enqueueOnMain(urls)
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        enqueueOnMain([URL(fileURLWithPath: filename)])
        return true
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        enqueueOnMain(filenames.map { URL(fileURLWithPath: $0) })
        // 必须告知 AppKit 已处理，否则可能再走一遍默认逻辑
        sender.reply(toOpenOrPrint: .success)
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        if !commandLineFileURLs().isEmpty { return false }
        return MainActor.assumeIsolated { !OpenFileRouter.shared.hasPending }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let files = commandLineFileURLs()
        guard !files.isEmpty else { return }
        enqueueOnMain(files)
    }

    private func enqueueOnMain(_ urls: [URL]) {
        let work = {
            OpenFileRouter.shared.enqueue(urls)
        }
        if Thread.isMainThread {
            MainActor.assumeIsolated(work)
        } else {
            DispatchQueue.main.async(work)
        }
    }

    private func commandLineFileURLs() -> [URL] {
        CommandLine.arguments.dropFirst().compactMap { arg -> URL? in
            guard !arg.hasPrefix("-") else { return nil }
            let url = URL(fileURLWithPath: arg)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir),
                  !isDir.boolValue else { return nil }
            return url
        }
    }
}
