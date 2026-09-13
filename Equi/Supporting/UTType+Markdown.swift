import Foundation
import UniformTypeIdentifiers

extension UTType {
    /// Markdown 文本（优先系统/扩展识别，回退到 `net.daringfireball.markdown` 或 plainText）。
    static var markdown: UTType {
        if let type = UTType(filenameExtension: "md"), type != .data {
            return type
        }
        if let type = UTType("net.daringfireball.markdown") {
            return type
        }
        return .plainText
    }
}
