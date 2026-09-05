import SwiftUI
import AppKit

struct ContentView: View {
    @EnvironmentObject private var document: DocumentModel
    @EnvironmentObject private var commands: EditorCommandBus

    var body: some View {
        VStack(spacing: 0) {
            EditorToolbar()
            Divider()
            WebViewBridge(document: document, commands: commands)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            statusBar
        }
        .navigationTitle(document.windowTitle)
        .onReceive(NotificationCenter.default.publisher(for: .editorUndo)) { _ in
            commands.undo()
        }
        .onReceive(NotificationCenter.default.publisher(for: .editorRedo)) { _ in
            commands.redo()
        }
        .onAppear { applyWindowTitle() }
        .onChange(of: document.windowTitle) { _ in applyWindowTitle() }
        .onChange(of: document.isDirty) { _ in applyWindowTitle() }
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

            if !document.isEditorReady {
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

    private func applyWindowTitle() {
        NSApp.keyWindow?.title = document.windowTitle
        NSApp.keyWindow?.representedURL = document.fileURL
    }
}

// MARK: - Toolbar

struct EditorToolbar: View {
    @EnvironmentObject private var document: DocumentModel
    @EnvironmentObject private var commands: EditorCommandBus

    var body: some View {
        HStack(spacing: 8) {
            Button { document.newDocument() } label: {
                Label("新建", systemImage: "doc.badge.plus")
            }
            .help("新建 (⌘N)")

            Button { document.openDocument() } label: {
                Label("打开", systemImage: "folder")
            }
            .help("打开 (⌘O)")

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
