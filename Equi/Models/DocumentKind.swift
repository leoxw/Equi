import Foundation
import UniformTypeIdentifiers

/// 文档编辑形态：Markdown 双栏，或纯文本单栏（保留原扩展名）。
enum DocumentKind: Equatable {
    case markdown
    /// 纯文本；`pathExtension` 为落盘扩展名（如 txt / json / swift，不含点）。
    case plain(pathExtension: String)

    var isMarkdown: Bool {
        if case .markdown = self { return true }
        return false
    }

    var pathExtension: String {
        switch self {
        case .markdown:
            return "md"
        case .plain(let ext):
            let trimmed = ext.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
            return trimmed.isEmpty ? "txt" : trimmed
        }
    }

    /// 传给 Web `EditorAPI.setEditingMode` 的 mode 值。
    var webMode: String { isMarkdown ? "markdown" : "plain" }

    var statusLabel: String {
        switch self {
        case .markdown:
            return "Markdown"
        case .plain(let ext):
            let e = ext.isEmpty ? "txt" : ext
            return "纯文本 (.\(e))"
        }
    }

    static let markdownExtensions: Set<String> = [
        "md", "markdown", "mdown", "mkd", "mdwn", "mkdn"
    ]

    static func infer(from url: URL) -> DocumentKind {
        let ext = url.pathExtension.lowercased()
        if markdownExtensions.contains(ext) {
            return .markdown
        }
        if ext.isEmpty {
            return .plain(pathExtension: "txt")
        }
        return .plain(pathExtension: ext)
    }
}
