import AppKit
import UniformTypeIdentifiers

/// 「存储为」面板的文件格式附件：Markdown (.md) / 纯文本 (.txt)。
@MainActor
final class SaveFormatAccessory: NSObject {
    enum Format: Int, CaseIterable {
        case markdown = 0
        case plainText = 1

        var contentType: UTType {
            switch self {
            case .markdown: return .markdown
            case .plainText: return .plainText
            }
        }

        var pathExtension: String {
            switch self {
            case .markdown: return "md"
            case .plainText: return "txt"
            }
        }

        var menuTitle: String {
            switch self {
            case .markdown: return "Markdown (.md)"
            case .plainText: return "纯文本 (.txt)"
            }
        }

        static func inferred(from url: URL?) -> Format {
            switch url?.pathExtension.lowercased() {
            case "txt", "text": return .plainText
            default: return .markdown
            }
        }
    }

    private weak var panel: NSSavePanel?
    private let popup: NSPopUpButton
    private(set) var selectedFormat: Format

    var contentView: NSView { container }
    private let container: NSView

    init(initial: Format = .markdown) {
        selectedFormat = initial
        popup = NSPopUpButton(frame: .zero, pullsDown: false)
        container = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 40))
        super.init()

        let label = NSTextField(labelWithString: "文件格式：")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: NSFont.smallSystemFontSize)

        popup.translatesAutoresizingMaskIntoConstraints = false
        popup.target = self
        popup.action = #selector(formatChanged(_:))
        popup.removeAllItems()
        for format in Format.allCases {
            popup.addItem(withTitle: format.menuTitle)
        }
        popup.selectItem(at: initial.rawValue)

        container.addSubview(label)
        container.addSubview(popup)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 8),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            popup.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 8),
            popup.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -8),
            popup.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            popup.widthAnchor.constraint(greaterThanOrEqualToConstant: 180),
        ])
    }

    func attach(to panel: NSSavePanel) {
        self.panel = panel
        panel.accessoryView = container
        panel.allowedContentTypes = [selectedFormat.contentType]
        panel.allowsOtherFileTypes = false
        applyExtensionToFileName(force: true)
    }

    @objc private func formatChanged(_ sender: NSPopUpButton) {
        let index = sender.indexOfSelectedItem
        guard let format = Format(rawValue: index) else { return }
        selectedFormat = format
        panel?.allowedContentTypes = [format.contentType]
        applyExtensionToFileName(force: true)
    }

    /// 把当前选中格式的扩展名同步到文件名。
    private func applyExtensionToFileName(force: Bool) {
        guard let panel else { return }
        let current = panel.nameFieldStringValue
        let base: String = {
            let ext = (current as NSString).pathExtension.lowercased()
            if ["md", "markdown", "txt", "text"].contains(ext) {
                return (current as NSString).deletingPathExtension
            }
            return current.isEmpty ? "未命名" : current
        }()
        let next = "\(base).\(selectedFormat.pathExtension)"
        if force || current != next {
            panel.nameFieldStringValue = next
        }
    }

    /// 根据面板返回的 URL 与所选格式，得到最终写入路径。
    func resolvedURL(from panelURL: URL) -> URL {
        var target = panelURL
        let ext = target.pathExtension.lowercased()
        let wanted = selectedFormat.pathExtension
        if ext.isEmpty {
            target = target.appendingPathExtension(wanted)
        } else if ext != wanted && ["md", "markdown", "txt", "text"].contains(ext) {
            target = target.deletingPathExtension().appendingPathExtension(wanted)
        }
        return target
    }
}
