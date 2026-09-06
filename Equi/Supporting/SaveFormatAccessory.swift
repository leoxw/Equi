import AppKit
import UniformTypeIdentifiers

/// 「存储为」面板格式附件：Markdown / 纯文本 /（可选）原格式。
@MainActor
final class SaveFormatAccessory: NSObject {
    struct Choice: Equatable {
        enum ID: Equatable {
            case markdown
            case plainText
            case original(String)
        }

        let id: ID
        let title: String
        let pathExtension: String

        var contentType: UTType {
            switch id {
            case .markdown:
                return .markdown
            case .plainText:
                return .plainText
            case .original:
                return UTType(filenameExtension: pathExtension) ?? .plainText
            }
        }

        var documentKind: DocumentKind {
            switch id {
            case .markdown:
                return .markdown
            case .plainText:
                return .plain(pathExtension: "txt")
            case .original(let ext):
                return .plain(pathExtension: ext)
            }
        }
    }

    private weak var panel: NSSavePanel?
    private let popup: NSPopUpButton
    private let choices: [Choice]
    private(set) var selectedChoice: Choice

    private let container: NSView

    /// - Parameter documentKind: 当前文档类型；非 md/txt 的纯文本会多出「原格式」选项。
    init(documentKind: DocumentKind) {
        var list: [Choice] = [
            Choice(id: .markdown, title: "Markdown (.md)", pathExtension: "md"),
            Choice(id: .plainText, title: "纯文本 (.txt)", pathExtension: "txt"),
        ]

        if case .plain(let ext) = documentKind {
            let e = ext.lowercased()
            if !e.isEmpty && e != "txt" && e != "text" && !DocumentKind.markdownExtensions.contains(e) {
                list.insert(
                    Choice(id: .original(e), title: "原格式 (.\(e))", pathExtension: e),
                    at: 0
                )
            }
        }

        choices = list
        selectedChoice = list[0]
        popup = NSPopUpButton(frame: .zero, pullsDown: false)
        container = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 40))
        super.init()

        // 默认选中与当前文档最匹配的项
        if let match = list.first(where: { $0.pathExtension == documentKind.pathExtension }) {
            selectedChoice = match
        } else if documentKind.isMarkdown,
                  let md = list.first(where: { if case .markdown = $0.id { return true }; return false }) {
            selectedChoice = md
        }

        let label = NSTextField(labelWithString: "文件格式：")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: NSFont.smallSystemFontSize)

        popup.translatesAutoresizingMaskIntoConstraints = false
        popup.target = self
        popup.action = #selector(formatChanged(_:))
        popup.removeAllItems()
        for choice in choices {
            popup.addItem(withTitle: choice.title)
        }
        if let idx = choices.firstIndex(of: selectedChoice) {
            popup.selectItem(at: idx)
        }

        container.addSubview(label)
        container.addSubview(popup)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 8),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            popup.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 8),
            popup.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -8),
            popup.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            popup.widthAnchor.constraint(greaterThanOrEqualToConstant: 200),
        ])
    }

    func attach(to panel: NSSavePanel) {
        self.panel = panel
        panel.accessoryView = container
        panel.allowedContentTypes = [selectedChoice.contentType]
        panel.allowsOtherFileTypes = false
        applyExtensionToFileName(force: true)
    }

    @objc private func formatChanged(_ sender: NSPopUpButton) {
        let index = sender.indexOfSelectedItem
        guard choices.indices.contains(index) else { return }
        selectedChoice = choices[index]
        panel?.allowedContentTypes = [selectedChoice.contentType]
        applyExtensionToFileName(force: true)
    }

    private func applyExtensionToFileName(force: Bool) {
        guard let panel else { return }
        let current = panel.nameFieldStringValue
        let base: String = {
            let ext = (current as NSString).pathExtension.lowercased()
            if !ext.isEmpty {
                return (current as NSString).deletingPathExtension
            }
            return current.isEmpty ? "未命名" : current
        }()
        let next = "\(base).\(selectedChoice.pathExtension)"
        if force || current != next {
            panel.nameFieldStringValue = next
        }
    }

    func resolvedURL(from panelURL: URL) -> URL {
        var target = panelURL
        let ext = target.pathExtension.lowercased()
        let wanted = selectedChoice.pathExtension.lowercased()
        if ext.isEmpty {
            target = target.appendingPathExtension(wanted)
        } else if ext != wanted {
            target = target.deletingPathExtension().appendingPathExtension(wanted)
        }
        return target
    }
}
