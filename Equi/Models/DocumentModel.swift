import Foundation
import Combine
import AppKit
import UniformTypeIdentifiers

/// 管理当前 Markdown 文档的内容、路径与脏状态。
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

    /// 最近一次由原生侧主动下发到 Web 的内容版本号，用于去重。
    private(set) var nativeRevision: UInt64 = 0

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
        return isDirty ? "未命名.md — 已编辑" : "未命名.md"
    }

    var windowTitle: String {
        let name = fileURL?.deletingPathExtension().lastPathComponent ?? "未命名"
        return isDirty ? "\(name) — 已编辑" : name
    }

    // MARK: - Content Updates (from Web)

    /// Web 编辑器通过 bridge 上报文档变更。
    func applyWebUpdate(markdown: String, dirty: Bool, words: Int, characters: Int) {
        // 避免与原生下发形成回环：内容相同则只更新元数据。
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
        // 粗略字数：按空白分词 + 中日文连续字符按字计。
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

    // MARK: - File Operations

    func newDocument() {
        fileURL = nil
        replaceContent("", markingClean: true)
    }

    @discardableResult
    func openDocument() -> Bool {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.markdown, .plainText, .text]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "选择要打开的 Markdown 文件"
        panel.prompt = "打开"
        panel.allowsOtherFileTypes = true

        guard panel.runModal() == .OK, let url = panel.url else {
            return false
        }
        return load(from: url)
    }

    @discardableResult
    func load(from url: URL) -> Bool {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            fileURL = url
            replaceContent(text, markingClean: true)
            return true
        } catch {
            presentError(error, title: "无法打开文件")
            return false
        }
    }

    @discardableResult
    func save() -> Bool {
        if let fileURL {
            return write(to: fileURL)
        }
        return saveAs()
    }

    @discardableResult
    func saveAs() -> Bool {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.markdown, .plainText]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "未命名.md"
        panel.message = "将 Markdown 文档另存为"
        panel.prompt = "存储"

        guard panel.runModal() == .OK, let url = panel.url else {
            return false
        }
        // 确保 .md 扩展名
        var target = url
        if target.pathExtension.isEmpty {
            target = target.appendingPathExtension("md")
        }
        return write(to: target)
    }

    private func write(to url: URL) -> Bool {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            fileURL = url
            isDirty = false
            return true
        } catch {
            presentError(error, title: "无法保存文件")
            return false
        }
    }

    private func presentError(_ error: Error, title: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = error.localizedDescription
        alert.alertStyle = .warning
        alert.runModal()
    }
}
