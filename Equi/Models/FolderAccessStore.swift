import AppKit
import Foundation

/// 沙盒下侧栏打开同目录文件需要**目录级** security-scoped 权限。
///
/// 约束：
/// - 禁止在 WK bridge 同步栈里 `runModal`（会死锁）
/// - 禁止在主线程做 iCloud 读盘 / 书签 resolve（会转圈卡死）
/// - 弹窗只用 `beginSheetModal`（或下一拍 `runModal` 作为无 window 回退）
@MainActor
final class FolderAccessStore {
    static let shared = FolderAccessStore()

    private let defaultsKey = "equi.folderSecurityBookmarks.v2"
    private let legacyDefaultsKey = "equi.folderSecurityBookmarks.v1"
    private var bookmarkDataByPath: [String: Data] = [:]
    private var activeAccessURLs: [String: URL] = [:]
    private var declinedThisSession: Set<String> = []
    private var isPrompting = false
    private var pendingPromptCompletions: [String: [(Bool) -> Void]] = [:]

    private init() {
        // v1 可能写入了会卡住 resolve 的坏书签；丢弃并改用 v2
        UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
        loadBookmarks()
    }

    /// 仅查内存中已激活的目录权限（不做书签 I/O）。
    func hasActiveAccess(toDirectory directory: URL) -> Bool {
        coveringActiveURL(for: Self.standardizedDirectory(directory)) != nil
    }

    func hasActiveAccess(toFile fileURL: URL) -> Bool {
        hasActiveAccess(toDirectory: fileURL.deletingLastPathComponent())
    }

    /// 异步请求目录权限。书签恢复在后台执行，面板在主线程以 sheet 呈现。
    func requestAccess(
        toDirectory directory: URL,
        message: String? = nil,
        sheetHost: NSWindow? = nil,
        completion: @escaping (Bool) -> Void
    ) {
        let dir = Self.standardizedDirectory(directory)
        let key = Self.pathKey(for: dir)

        if coveringActiveURL(for: dir) != nil {
            completion(true)
            return
        }
        if declinedThisSession.contains(key) {
            completion(false)
            return
        }

        pendingPromptCompletions[key, default: []].append(completion)
        guard !isPrompting else { return }
        isPrompting = true

        let bookmarkSnapshot = bookmarkDataByPath
        Task.detached(priority: .userInitiated) { [weak self] in
            let restored = Self.restoreBookmarkOffMain(
                for: dir,
                bookmarks: bookmarkSnapshot
            )
            await MainActor.run {
                guard let self else { return }
                if let restored {
                    self.activate(url: restored)
                    if self.coveringActiveURL(for: dir) != nil {
                        self.finishPrompt(forKey: key, ok: true)
                        return
                    }
                }
                // 再下一拍，彻底离开任何 bridge/Open 面板调用栈
                DispatchQueue.main.async {
                    self.presentDirectoryPrompt(
                        for: dir,
                        message: message,
                        sheetHost: sheetHost ?? NSApp.keyWindow
                    )
                }
            }
        }
    }

    func requestAccess(
        toFile fileURL: URL,
        sheetHost: NSWindow? = nil,
        completion: @escaping (Bool) -> Void
    ) {
        let dir = fileURL.deletingLastPathComponent()
        requestAccess(
            toDirectory: dir,
            message: Self.defaultPromptMessage(for: dir),
            sheetHost: sheetHost,
            completion: completion
        )
    }

    func rememberUserSelected(_ url: URL) {
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        guard exists, isDir.boolValue else {
            // 单文件 Open 无法升级为目录权限；不写书签、不做读盘探测
            return
        }
        let dir = Self.standardizedDirectory(url)
        declinedThisSession.remove(Self.pathKey(for: dir))
        activate(url: dir)
        saveBookmark(for: dir)
    }

    // MARK: - Off-main bookmark restore

    /// 在后台线程解析书签；成功则返回需在主线程 activate 的 URL。
    nonisolated private static func restoreBookmarkOffMain(
        for directory: URL,
        bookmarks: [String: Data]
    ) -> URL? {
        var cursor = standardizedDirectory(directory)
        while true {
            let key = pathKey(for: cursor)
            if let data = bookmarks[key] {
                var isStale = false
                if let resolved = try? URL(
                    resolvingBookmarkData: data,
                    options: [.withSecurityScope],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                ), resolved.startAccessingSecurityScopedResource() {
                    return resolved
                }
            }
            let parent = cursor.deletingLastPathComponent()
            if parent.path == cursor.path { break }
            cursor = parent
        }
        return nil
    }

    // MARK: - Internals

    nonisolated private static func standardizedDirectory(_ url: URL) -> URL {
        url.standardizedFileURL
    }

    nonisolated private static func pathKey(for url: URL) -> String {
        standardizedDirectory(url).path
    }

    private static func defaultPromptMessage(for directory: URL) -> String {
        let name = directory.lastPathComponent
        return "请选择并授权访问「\(name)」文件夹。授权后即可在左侧打开其中的其他文件。"
    }

    private func coveringActiveURL(for directory: URL) -> URL? {
        let path = Self.pathKey(for: directory)
        for (key, url) in activeAccessURLs {
            if path == key { return url }
            if key != "/", path.hasPrefix(key + "/") { return url }
            if key == "/" { return url }
        }
        return nil
    }

    private func activate(url: URL) {
        let key = Self.pathKey(for: url)
        if activeAccessURLs[key] != nil { return }
        _ = url.startAccessingSecurityScopedResource()
        activeAccessURLs[key] = url
    }

    private func presentDirectoryPrompt(for directory: URL, message: String?, sheetHost: NSWindow?) {
        let key = Self.pathKey(for: directory)
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.directoryURL = directory
        panel.message = message ?? Self.defaultPromptMessage(for: directory)
        panel.prompt = "授权访问"

        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] result in
            guard let self else { return }
            var ok = false
            if result == .OK, let selected = panel.url {
                let chosen = Self.standardizedDirectory(selected)
                if chosen.startAccessingSecurityScopedResource() {
                    self.activeAccessURLs[Self.pathKey(for: chosen)] = chosen
                    self.saveBookmark(for: chosen)
                    self.declinedThisSession.remove(key)
                    self.declinedThisSession.remove(Self.pathKey(for: chosen))
                    ok = self.coveringActiveURL(for: directory) != nil
                }
            } else {
                self.declinedThisSession.insert(key)
            }
            self.finishPrompt(forKey: key, ok: ok)
        }

        if let sheetHost {
            panel.beginSheetModal(for: sheetHost, completionHandler: finish)
        } else {
            // 无 window时退回 modal，但仍在异步上下文中
            let result = panel.runModal()
            finish(result)
        }
    }

    private func finishPrompt(forKey key: String, ok: Bool) {
        isPrompting = false
        let completions = pendingPromptCompletions.removeValue(forKey: key) ?? []
        var remaining = pendingPromptCompletions
        pendingPromptCompletions = [:]
        completions.forEach { $0(ok) }
        for (pendingKey, pendingCompletions) in remaining {
            let pendingURL = URL(fileURLWithPath: pendingKey, isDirectory: true)
            if coveringActiveURL(for: pendingURL) != nil {
                pendingCompletions.forEach { $0(true) }
            } else {
                pendingPromptCompletions[pendingKey] = pendingCompletions
            }
        }
        if let nextKey = pendingPromptCompletions.keys.first {
            let nextURL = URL(fileURLWithPath: nextKey, isDirectory: true)
            isPrompting = true
            DispatchQueue.main.async { [weak self] in
                self?.presentDirectoryPrompt(
                    for: nextURL,
                    message: nil,
                    sheetHost: NSApp.keyWindow
                )
            }
        }
    }

    private func saveBookmark(for directory: URL) {
        let key = Self.pathKey(for: directory)
        do {
            let data = try directory.bookmarkData(
                options: [.withSecurityScope],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            bookmarkDataByPath[key] = data
            persistBookmarks()
        } catch {
            /* ignore */
        }
    }

    private func loadBookmarks() {
        guard let raw = UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Data] else {
            return
        }
        bookmarkDataByPath = raw
    }

    private func persistBookmarks() {
        UserDefaults.standard.set(bookmarkDataByPath, forKey: defaultsKey)
    }
}
