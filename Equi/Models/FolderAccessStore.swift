import AppKit
import Foundation

/// 沙盒下侧栏打开同目录文件需要**目录级** security-scoped 权限。
/// `NSOpenPanel` 选中单个文件只授予该文件；本类负责请求/持久化文件夹书签并保持访问。
///
/// 注意：切勿在 `WKScriptMessageHandler` 同步回调里 `runModal()`，否则会与 WebKit 死锁。
/// 需要弹窗时请走 `requestAccess`（下一 runloop 再呈现面板）。
@MainActor
final class FolderAccessStore {
    static let shared = FolderAccessStore()

    private let defaultsKey = "equi.folderSecurityBookmarks.v1"
    /// 标准化路径 → bookmark Data
    private var bookmarkDataByPath: [String: Data] = [:]
    /// 当前已 `startAccessing` 的目录（路径 → URL）
    private var activeAccessURLs: [String: URL] = [:]
    /// 本会话内用户取消授权的目录，避免反复弹窗
    private var declinedThisSession: Set<String> = []
    /// 正在弹出的授权，避免连点侧栏叠多个面板
    private var isPrompting = false
    private var pendingPromptCompletions: [String: [(Bool) -> Void]] = [:]

    private init() {
        loadBookmarks()
    }

    // MARK: - Public

    /// 静默恢复书签 / 已激活权限。**绝不弹窗、不读盘探测**（避免 iCloud 主线程卡住）。
    func hasAccess(toDirectory directory: URL) -> Bool {
        let dir = Self.standardizedDirectory(directory)
        if coveringActiveURL(for: dir) != nil { return true }

        var cursor = dir
        while true {
            if restoreBookmark(at: cursor), coveringActiveURL(for: dir) != nil {
                return true
            }
            let parent = cursor.deletingLastPathComponent()
            if parent.path == cursor.path { break }
            cursor = parent
        }
        return false
    }

    func hasAccess(toFile fileURL: URL) -> Bool {
        hasAccess(toDirectory: fileURL.deletingLastPathComponent())
    }

    /// 异步请求目录权限：已有则立刻回调；否则下一拍弹出文件夹选择面板。
    func requestAccess(
        toDirectory directory: URL,
        message: String? = nil,
        completion: @escaping (Bool) -> Void
    ) {
        let dir = Self.standardizedDirectory(directory)
        let key = Self.pathKey(for: dir)

        if hasAccess(toDirectory: dir) {
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
        // 脱离 WK / Open 面板的同步调用栈，避免 runModal 死锁
        DispatchQueue.main.async { [weak self] in
            self?.presentDirectoryPrompt(for: dir, message: message)
        }
    }

    func requestAccess(toFile fileURL: URL, completion: @escaping (Bool) -> Void) {
        let dir = fileURL.deletingLastPathComponent()
        requestAccess(
            toDirectory: dir,
            message: Self.defaultPromptMessage(for: dir),
            completion: completion
        )
    }

    /// 用户通过 Open/Save 面板选中文件或文件夹后调用。
    func rememberUserSelected(_ url: URL) {
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        let dir: URL
        if exists && isDir.boolValue {
            dir = Self.standardizedDirectory(url)
        } else {
            dir = Self.standardizedDirectory(url.deletingLastPathComponent())
        }
        declinedThisSession.remove(Self.pathKey(for: dir))

        // 仅当用户直接选了文件夹时，才能把 scope 记成目录书签
        if exists && isDir.boolValue {
            activate(url: dir)
            saveBookmark(for: dir)
        }
    }

    // MARK: - Internals

    private static func standardizedDirectory(_ url: URL) -> URL {
        // 不用 resolvingSymlinksInPath：在 iCloud/Mobile Documents 上可能极慢或卡住
        url.standardizedFileURL
    }

    private static func pathKey(for url: URL) -> String {
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

    @discardableResult
    private func restoreBookmark(at directory: URL) -> Bool {
        let key = Self.pathKey(for: directory)
        guard let data = bookmarkDataByPath[key] else { return false }
        var isStale = false
        do {
            let resolved = try URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            guard resolved.startAccessingSecurityScopedResource() else {
                return false
            }
            activeAccessURLs[Self.pathKey(for: resolved)] = resolved
            if isStale {
                saveBookmark(for: resolved)
            }
            return true
        } catch {
            bookmarkDataByPath.removeValue(forKey: key)
            persistBookmarks()
            return false
        }
    }

    private func presentDirectoryPrompt(for directory: URL, message: String?) {
        let key = Self.pathKey(for: directory)
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.directoryURL = directory
        panel.message = message ?? Self.defaultPromptMessage(for: directory)
        panel.prompt = "授权访问"

        let result = panel.runModal()
        var ok = false
        if result == .OK, let selected = panel.url {
            let chosen = Self.standardizedDirectory(selected)
            if chosen.startAccessingSecurityScopedResource() {
                activeAccessURLs[Self.pathKey(for: chosen)] = chosen
                saveBookmark(for: chosen)
                declinedThisSession.remove(key)
                declinedThisSession.remove(Self.pathKey(for: chosen))
                ok = coveringActiveURL(for: directory) != nil
            }
        } else {
            declinedThisSession.insert(key)
        }

        isPrompting = false
        let completions = pendingPromptCompletions.removeValue(forKey: key) ?? []
        // 若用户授权了祖先目录，其它等待中的子目录请求也可能已满足
        var remaining = pendingPromptCompletions
        pendingPromptCompletions = [:]
        for completion in completions {
            completion(ok)
        }
        for (pendingKey, pendingCompletions) in remaining {
            let pendingURL = URL(fileURLWithPath: pendingKey, isDirectory: true)
            if hasAccess(toDirectory: pendingURL) {
                pendingCompletions.forEach { $0(true) }
            } else {
                pendingPromptCompletions[pendingKey] = pendingCompletions
            }
        }
        // 仍有未满足的请求则继续弹一次
        if let nextKey = pendingPromptCompletions.keys.first {
            let nextURL = URL(fileURLWithPath: nextKey, isDirectory: true)
            isPrompting = true
            DispatchQueue.main.async { [weak self] in
                self?.presentDirectoryPrompt(for: nextURL, message: nil)
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
            // 无 security scope 时创建书签可能失败，忽略
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
