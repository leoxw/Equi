import AppKit
import Foundation

/// 沙盒下侧栏打开同目录文件需要**目录级** security-scoped 权限。
/// `NSOpenPanel` 选中单个文件只授予该文件；本类负责请求/持久化文件夹书签并保持访问。
@MainActor
final class FolderAccessStore {
    static let shared = FolderAccessStore()

    private let defaultsKey = "equi.folderSecurityBookmarks.v1"
    /// 标准化路径 → bookmark Data
    private var bookmarkDataByPath: [String: Data] = [:]
    /// 当前已 `startAccessing` 的目录（路径 → URL）
    private var activeAccessURLs: [String: URL] = [:]
    /// 本会话内用户取消授权的目录，避免列表刷新时反复弹窗
    private var declinedThisSession: Set<String> = []

    private init() {
        loadBookmarks()
    }

    // MARK: - Public

    /// 确保可读写 `directory` 内的文件（侧栏打开、媒体目录等）。
    @discardableResult
    func ensureAccess(
        toDirectory directory: URL,
        promptIfNeeded: Bool,
        message: String? = nil
    ) -> Bool {
        let dir = Self.standardizedDirectory(directory)
        let key = Self.pathKey(for: dir)

        if coveringActiveURL(for: dir) != nil {
            return true
        }

        // 自该目录向根查找已保存的书签并恢复
        var cursor = dir
        while true {
            if restoreBookmark(at: cursor), coveringActiveURL(for: dir) != nil {
                return true
            }
            let parent = cursor.deletingLastPathComponent()
            if parent.path == cursor.path { break }
            cursor = parent
        }

        // 已能读取同目录其他文件（非仅单文件 scope）
        if canReadSiblingFiles(in: dir, besides: nil) {
            activate(url: dir)
            saveBookmark(for: dir)
            declinedThisSession.remove(key)
            return true
        }

        guard promptIfNeeded else { return false }
        if declinedThisSession.contains(key) { return false }
        return promptUserForDirectory(dir, message: message)
    }

    /// 确保可读取某个文件：优先恢复其父目录权限；失败时可弹窗授权。
    @discardableResult
    func ensureAccess(toFile fileURL: URL, promptIfNeeded: Bool) -> Bool {
        ensureAccess(
            toDirectory: fileURL.deletingLastPathComponent(),
            promptIfNeeded: promptIfNeeded,
            message: Self.defaultPromptMessage(for: fileURL.deletingLastPathComponent())
        )
    }

    /// 用户通过 Open/Save 面板选中文件或文件夹后调用，尽量记下目录书签。
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

        // 面板返回的 URL 本身带 scope：对文件夹直接激活；对文件无法把 scope「升级」到父目录
        if exists && isDir.boolValue {
            activate(url: dir)
            saveBookmark(for: dir)
            return
        }

        // 若已能任意读取同目录其他文件，说明已有目录级权限（或非沙盒），尝试持久化
        if canReadSiblingFiles(in: dir, besides: url) {
            activate(url: dir)
            saveBookmark(for: dir)
        }
    }

    // MARK: - Internals

    private static func standardizedDirectory(_ url: URL) -> URL {
        url.standardizedFileURL.resolvingSymlinksInPath()
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
        // 已激活的祖先目录即可覆盖子路径
        for (key, url) in activeAccessURLs {
            if path == key { return url }
            if path.hasPrefix(key.hasSuffix("/") ? key : key + "/") { return url }
            // 根目录特殊情况
            if key == "/" { return url }
        }
        return nil
    }

    private func activate(url: URL) {
        let key = Self.pathKey(for: url)
        if activeAccessURLs[key] != nil { return }
        // 无 security scope 时 start 也会返回 false，但仍可能因其他原因可读；先尝试
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

    private func promptUserForDirectory(_ directory: URL, message: String?) -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.directoryURL = directory
        panel.message = message ?? Self.defaultPromptMessage(for: directory)
        panel.prompt = "授权访问"

        guard panel.runModal() == .OK, let selected = panel.url else {
            declinedThisSession.insert(Self.pathKey(for: directory))
            return false
        }

        let chosen = Self.standardizedDirectory(selected)
        guard chosen.startAccessingSecurityScopedResource() else {
            return false
        }
        activeAccessURLs[Self.pathKey(for: chosen)] = chosen
        saveBookmark(for: chosen)
        declinedThisSession.remove(Self.pathKey(for: directory))
        declinedThisSession.remove(Self.pathKey(for: chosen))

        // 用户可能选了目标目录或其祖先
        return coveringActiveURL(for: directory) != nil
    }

    /// 探测是否已有目录级可读权限（排除当前已打开、仅有单文件 scope 的那份）。
    private func canReadSiblingFiles(in directory: URL, besides excluded: URL?) -> Bool {
        let excludedPath = excluded.map { $0.standardizedFileURL.path }
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }
        for item in items {
            if item.standardizedFileURL.path == excludedPath { continue }
            let values = try? item.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey])
            if values?.isDirectory == true { continue }
            if values?.isRegularFile != true { continue }
            if (try? Data(contentsOf: item, options: [.uncached])) != nil {
                return true
            }
            // 存在同目录文件但读失败 → 仍是单文件权限
            return false
        }
        return false
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
