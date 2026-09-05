import Foundation
import UniformTypeIdentifiers

extension UTType {
    /// Markdown 文本（系统可能未内置，回退到 plainText）。
    static var markdown: UTType {
        UTType(filenameExtension: "md") ?? .plainText
    }
}
