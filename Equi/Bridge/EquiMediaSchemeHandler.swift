import Foundation
import WebKit
import UniformTypeIdentifiers

/// 为 WKWebView 提供 `equimedia:///` 媒体读取。
/// 沙盒下页面不能直接加载用户目录的 `file://` 图片；此 handler 在 App 进程内
/// 借助 security-scoped 访问读盘并回传数据。
final class EquiMediaSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "equimedia"

    weak var document: DocumentModel?

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(Self.error(code: 1, message: "无效的媒体 URL"))
            return
        }

        let relative = Self.relativePath(from: url)
        guard !relative.isEmpty else {
            urlSchemeTask.didFailWithError(Self.error(code: 2, message: "媒体路径为空"))
            return
        }

        guard let fileURL = document?.resolveMediaFileURL(forRelativePath: relative) else {
            urlSchemeTask.didFailWithError(Self.error(code: 3, message: "文稿尚未保存，无法加载媒体"))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let mime = Self.mimeType(for: fileURL)
            let response = URLResponse(
                url: url,
                mimeType: mime,
                expectedContentLength: data.count,
                textEncodingName: nil
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 同步读盘，无取消逻辑
    }

    /// `equimedia:///Notesmedia/a.png` → `Notesmedia/a.png`
    private static func relativePath(from url: URL) -> String {
        var path = url.path
        if path.hasPrefix("/") {
            path = String(path.dropFirst())
        }
        return path.removingPercentEncoding ?? path
    }

    private static func mimeType(for fileURL: URL) -> String {
        if let type = UTType(filenameExtension: fileURL.pathExtension),
           let mime = type.preferredMIMEType {
            return mime
        }
        switch fileURL.pathExtension.lowercased() {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "bmp": return "image/bmp"
        case "tif", "tiff": return "image/tiff"
        case "svg": return "image/svg+xml"
        case "heic", "heif": return "image/heic"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }

    private static func error(code: Int, message: String) -> NSError {
        NSError(domain: "EquiMedia", code: code, userInfo: [
            NSLocalizedDescriptionKey: message,
        ])
    }
}
