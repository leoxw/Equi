import Foundation
import Combine
import AppKit
import UniformTypeIdentifiers

/// 管理当前文档的内容、路径、格式与脏状态。
@MainActor
final class DocumentModel: ObservableObject {

    // MARK: - Published State

    @Published var content: String = ""
    @Published var fileURL: URL?
    @Published var isDirty: Bool = false
    @Published var wordCount: Int = 0
    @Published var characterCount: Int = 0
    @Published var isEditorReady: Bool = false
    /// Web 编辑器加载失败时的可读原因；非 nil 时 UI 应撤掉转圈并展示错误。
    @Published var editorLoadError: String? = nil
    /// Markdown 双栏 / 纯文本单栏。
    @Published var kind: DocumentKind = .markdown

    /// 最近一次由原生侧主动下发到 Web 的内容版本号，用于去重。
    private(set) var nativeRevision: UInt64 = 0

    /// 打开/保存后保持的 security-scoped 访问（沙盒下读写同目录媒体需要）。
    private var securityScopedURL: URL?
    private var hasSecurityScopedAccess = false

    func markEditorFailed(_ message: String) {
        editorLoadError = message
        isEditorReady = false
    }

    func markEditorReady() {
        editorLoadError = nil
        isEditorReady = true
    }

    var displayTitle: String {
        if let fileURL {
            return fileURL.lastPathComponent
        }
        let ext = kind.pathExtension
        return isDirty ? "未命名.\(ext) — 已编辑" : "未命名.\(ext)"
    }

    var windowTitle: String {
        let name = fileURL?.deletingPathExtension().lastPathComponent ?? "未命名"
        return isDirty ? "\(name) — 已编辑" : name
    }

    // MARK: - Content Updates (from Web)

    /// Web 编辑器通过 bridge 上报文档变更。
    func applyWebUpdate(markdown: String, dirty: Bool, words: Int, characters: Int) {
        if content != markdown {
            content = markdown
        }
        isDirty = dirty
        wordCount = words
        characterCount = characters
    }

    /// 原生侧主动替换全文（打开文件 / 新建），并递增修订号。
    func replaceContent(_ markdown: String, markingClean: Bool = false) {
        content = markdown
        nativeRevision &+= 1
        if markingClean {
            isDirty = false
        } else {
            isDirty = true
        }
        recalculateStats()
    }

    private func recalculateStats() {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            wordCount = 0
            characterCount = 0
            return
        }
        characterCount = content.count
        let latinWords = trimmed
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .count
        let cjk = trimmed.unicodeScalars.filter {
            (0x4E00...0x9FFF).contains($0.value) ||
            (0x3400...0x4DBF).contains($0.value) ||
            (0x3040...0x30FF).contains($0.value)
        }.count
        wordCount = max(latinWords, cjk)
    }

    // MARK: - Media folder ({stem}media)

    /// 文稿 `Notes.md` → 文件夹名 `Notesmedia`（仅插入媒体时创建）。
    var mediaFolderName: String? {
        guard let fileURL else { return nil }
        return fileURL.deletingPathExtension().lastPathComponent + "media"
    }

    var mediaFolderURL: URL? {
        guard let fileURL, let mediaFolderName else { return nil }
        return fileURL.deletingLastPathComponent().appendingPathComponent(mediaFolderName, isDirectory: true)
    }

    /// 文稿所在目录的 file URL（尾部带 `/`），供 Web 解析相对媒体路径。
    var documentDirectoryURLString: String? {
        guard let fileURL else { return nil }
        var dir = fileURL.deletingLastPathComponent()
        if !dir.absoluteString.hasSuffix("/") {
            dir = URL(fileURLWithPath: dir.path + "/", isDirectory: true)
        }
        return dir.absoluteString
    }

    private func retainSecurityScope(for url: URL) {
        releaseSecurityScope()
        securityScopedURL = url
        hasSecurityScopedAccess = url.startAccessingSecurityScopedResource()
    }

    private func releaseSecurityScope() {
        if hasSecurityScopedAccess, let securityScopedURL {
            securityScopedURL.stopAccessingSecurityScopedResource()
        }
        securityScopedURL = nil
        hasSecurityScopedAccess = false
    }

    /// 确保 `{stem}media` 存在；仅在插入媒体时调用。
    @discardableResult
    func ensureMediaFolder() throws -> URL {
        guard let folder = mediaFolderURL else {
            throw NSError(domain: "Equi", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "请先保存文稿，再插入图片或媒体文件。",
            ])
        }
        let fm = FileManager.default
        if !fm.fileExists(atPath: folder.path) {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder
    }

    /// 将本地文件拷入媒体目录，返回 Markdown 相对路径（如 `Notesmedia/a.png`）。
    func importMediaFile(from sourceURL: URL) throws -> String {
        let folder = try ensureMediaFolder()
        let folderName = mediaFolderName!
        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer { if accessed { sourceURL.stopAccessingSecurityScopedResource() } }

        let original = sourceURL.lastPathComponent
        let destName = uniqueMediaFileName(original, in: folder)
        let dest = folder.appendingPathComponent(destName)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.copyItem(at: sourceURL, to: dest)
        return "\(folderName)/\(destName)"
    }

    /// 将内存数据写入媒体目录（粘贴图片等），返回相对路径。
    func importMediaData(_ data: Data, preferredName: String) throws -> String {
        let folder = try ensureMediaFolder()
        let folderName = mediaFolderName!
        let destName = uniqueMediaFileName(preferredName, in: folder)
        let dest = folder.appendingPathComponent(destName)
        try data.write(to: dest, options: .atomic)
        return "\(folderName)/\(destName)"
    }

    private func uniqueMediaFileName(_ original: String, in folder: URL) -> String {
        let fm = FileManager.default
        let trimmed = original.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseName = trimmed.isEmpty ? "image.png" : trimmed
        var candidate = baseName
        let stem = (baseName as NSString).deletingPathExtension
        let ext = (baseName as NSString).pathExtension
        var index = 1
        while fm.fileExists(atPath: folder.appendingPathComponent(candidate).path) {
            if ext.isEmpty {
                candidate = "\(stem)-\(index)"
            } else {
                candidate = "\(stem)-\(index).\(ext)"
            }
            index += 1
        }
        return candidate
    }

    /// 相对媒体路径 → 预览用 URL（`equimedia:///`，由 WKURLSchemeHandler 读盘）。
    func absoluteMediaURLString(forRelativePath relative: String) -> String? {
        guard fileURL != nil else { return nil }
        let trimmed = relative.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty else { return nil }
        let encoded = trimmed
            .split(separator: "/")
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
            .joined(separator: "/")
        return "equimedia:///\(encoded)"
    }

    /// 解析相对媒体路径为磁盘上的绝对文件 URL。
    func resolveMediaFileURL(forRelativePath relative: String) -> URL? {
        guard let fileURL else { return nil }
        let trimmed = relative.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty else { return nil }
        return fileURL.deletingLastPathComponent().appendingPathComponent(trimmed)
    }

    // MARK: - File Operations

    /// 新建：先弹出存储面板指定路径与文件名，写入空文稿并返回 URL。
    static func promptCreateNewFile() -> URL? {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.message = "选择新建文稿的保存位置与文件名"
        panel.prompt = "创建"
        panel.isExtensionHidden = false
        panel.allowedContentTypes = [.markdown, .plainText]
        panel.nameFieldStringValue = "未命名.md"

        let accessory = SaveFormatAccessory(documentKind: .markdown)
        accessory.attach(to: panel)

        guard panel.runModal() == .OK, let url = panel.url else {
            return nil
        }
        let target = accessory.resolvedURL(from: url)
        do {
            try "".write(to: target, atomically: true, encoding: .utf8)
            return target
        } catch {
            let alert = NSAlert()
            alert.messageText = "无法创建文稿"
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .warning
            alert.runModal()
            return nil
        }
    }

    func newDocument() {
        releaseSecurityScope()
        fileURL = nil
        kind = .markdown
        replaceContent("", markingClean: true)
    }

    @discardableResult
    func openDocument() -> Bool {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.markdown, .plainText, .text, .json, .xml, .sourceCode, .data]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "选择要打开的文本文件（Markdown / 纯文本 / 其他文本格式）"
        panel.prompt = "打开"
        // 允许 .swift / .toml 等未在 UTType 列表中的扩展名
        panel.allowsOtherFileTypes = true

        guard panel.runModal() == .OK, let url = panel.url else {
            return false
        }
        return load(from: url)
    }

    private static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "svg",
    ]

    @discardableResult
    func load(from url: URL) -> Bool {
        if Self.imageExtensions.contains(url.pathExtension.lowercased()) {
            presentError(
                NSError(domain: "Equi", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "图片请拖入编辑器正文插入，不能作为文档打开。",
                ]),
                title: "无法打开图片文件"
            )
            return false
        }
        // Finder「打开方式」会带上 security-scoped 权限；保持到文稿关闭以便读写同目录媒体
        retainSecurityScope(for: url)
        do {
            let data = try Data(contentsOf: url)
            let text = String(decoding: data, as: UTF8.self)
            fileURL = url
            kind = DocumentKind.infer(from: url)
            replaceContent(text, markingClean: true)
            return true
        } catch {
            releaseSecurityScope()
            presentError(error, title: "无法打开文件")
            return false
        }
    }

    @discardableResult
    func save() -> Bool {
        // 已有路径：按原格式原路径写入（纯文本保留 .json/.swift 等）
        if let fileURL {
            return write(to: fileURL, updatingKind: false)
        }
        return saveAs()
    }

    @discardableResult
    func saveAs() -> Bool {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.message = "选择保存位置与文件格式"
        panel.prompt = "存储"
        panel.isExtensionHidden = false

        let accessory = SaveFormatAccessory(documentKind: kind)
        let defaultName: String = {
            let base = fileURL?.deletingPathExtension().lastPathComponent ?? "未命名"
            return "\(base).\(accessory.selectedChoice.pathExtension)"
        }()
        panel.nameFieldStringValue = defaultName
        accessory.attach(to: panel)

        guard panel.runModal() == .OK, let url = panel.url else {
            return false
        }
        let target = accessory.resolvedURL(from: url)
        kind = accessory.selectedChoice.documentKind
        return write(to: target, updatingKind: false)
    }

    private func write(to url: URL, updatingKind: Bool) -> Bool {
        retainSecurityScope(for: url)
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            fileURL = url
            if updatingKind {
                kind = DocumentKind.infer(from: url)
            }
            isDirty = false
            return true
        } catch {
            presentError(error, title: "无法保存文件")
            return false
        }
    }

    /// 插入媒体前若尚未落盘，先引导存储。
    @discardableResult
    func ensureSavedForMediaInsert() -> Bool {
        if fileURL != nil { return true }
        let alert = NSAlert()
        alert.messageText = "需要先保存文稿"
        alert.informativeText = "图片等媒体会存到「文稿名media」文件夹。请先指定保存位置与文件名。"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "存储…")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        return saveAs()
    }

    private func presentError(_ error: Error, title: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = error.localizedDescription
        alert.alertStyle = .warning
        alert.runModal()
    }
}
