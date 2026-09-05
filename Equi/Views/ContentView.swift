import SwiftUI
import AppKit

struct ContentView: View {
    @EnvironmentObject private var document: DocumentModel
    @EnvironmentObject private var commands: EditorCommandBus
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 0) {
            EditorToolbar(openNewWindow: { openWindow(id: "document") })
            Divider()
            editorStatusBanner
            editorPane
            Divider()
            statusBar
        }
        .navigationTitle(document.windowTitle)
        // 把标题写到本窗口，而不是 NSApp.keyWindow（多标签会串名）
        .background(
            WindowTitleBinder(
                title: document.windowTitle,
                representedURL: document.fileURL
            )
        )
    }

    /// 顶栏状态：绝不盖住 WebView，否则失败页/探针会被挡住，看起来像“一直加载”。
    @ViewBuilder
    private var editorStatusBanner: some View {
        if let error = document.editorLoadError {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.12))
        } else if !document.isEditorReady {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("正在加载编辑器…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.bar)
        }
    }

    /// GeometryReader 把明确宽高传给 WKWebView，避免中间区域塌成 0。
    private var editorPane: some View {
        GeometryReader { proxy in
            ZStack {
                Color(nsColor: .textBackgroundColor)
                WebViewBridge(document: document, commands: commands)
                    .frame(width: max(proxy.size.width, 1), height: max(proxy.size.height, 1))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .layoutPriority(1)
    }

    private var statusBar: some View {
        HStack(spacing: 16) {
            Group {
                if document.isDirty {
                    Text("未保存").foregroundStyle(.orange)
                } else {
                    Text("已保存").foregroundStyle(.secondary)
                }
            }

            if let url = document.fileURL {
                Text(url.path)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(.secondary)
                    .help(url.path)
            } else {
                Text("内存文档").foregroundStyle(.secondary)
            }

            Spacer()

            Text("\(document.wordCount) 词 · \(document.characterCount) 字符")
                .monospacedDigit()
                .foregroundStyle(.secondary)

            if document.editorLoadError != nil {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(.orange)
                    .help("编辑器加载失败")
            } else if !document.isEditorReady {
                ProgressView()
                    .controlSize(.small)
                    .help("编辑器加载中…")
            }
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.bar)
    }
}

// MARK: - Toolbar

struct EditorToolbar: View {
    @EnvironmentObject private var document: DocumentModel
    @EnvironmentObject private var commands: EditorCommandBus
    var openNewWindow: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: openNewWindow) {
                Label("新建", systemImage: "doc.badge.plus")
            }
            .help("新建窗口 (⌘N)")

            Button { document.openDocument() } label: {
                Label("打开", systemImage: "folder")
            }
            .help("在当前窗口打开 (⌘O)")

            Button { _ = document.save() } label: {
                Label("存储", systemImage: "square.and.arrow.down")
            }
            .help("存储 (⌘S)")
            .disabled(!document.isDirty && document.fileURL != nil)

            Divider().frame(height: 16)

            Button { commands.undo() } label: {
                Label("撤销", systemImage: "arrow.uturn.backward")
            }
            .help("撤销 (⌘Z)")

            Button { commands.redo() } label: {
                Label("重做", systemImage: "arrow.uturn.forward")
            }
            .help("重做 (⌘⇧Z)")

            Spacer()

            Text(document.displayTitle)
                .font(.headline)
                .lineLimit(1)

            Spacer()

            Button { commands.focusSource() } label: {
                Label("源码", systemImage: "chevron.left.forwardslash.chevron.right")
            }
            .help("聚焦左侧 Markdown 源码")

            Button { commands.focusWysiwyg() } label: {
                Label("预览编辑", systemImage: "doc.richtext")
            }
            .help("聚焦右侧所见即所得")
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}
