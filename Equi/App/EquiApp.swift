import SwiftUI
import AppKit

@main
struct EquiApp: App {
    @NSApplicationDelegateAdaptor(EquiAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup(id: "document") {
            DocumentWorkspaceView()
                .frame(minWidth: 880, minHeight: 560)
                .background(WindowChromeConfigurator())
        }
        .windowStyle(.automatic)
        .windowToolbarStyle(.unified)
        .commands {
            EquiCommands()
        }
        .handlesExternalEvents(matching: Set(arrayLiteral: "*"))
    }
}

/// 单窗口根视图：隔离 DocumentModel，并消费 Finder 传入的待打开文件。
struct DocumentWorkspaceView: View {
    @StateObject private var document = DocumentModel()
    @StateObject private var commands = EditorCommandBus()
    @ObservedObject private var openRouter = OpenFileRouter.shared
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ContentView()
            .environmentObject(document)
            .environmentObject(commands)
            .focusedSceneObject(document)
            .focusedSceneObject(commands)
            .onAppear {
                consumePendingFileIfNeeded()
                // Launch Services 有时晚于首屏；短延迟再取一次
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    consumePendingFileIfNeeded()
                }
            }
            .onChange(of: openRouter.epoch) { _ in
                consumePendingFileIfNeeded()
            }
            .onOpenURL { url in
                guard url.isFileURL else { return }
                openIncomingFile(url)
            }
            .onReceive(NotificationCenter.default.publisher(for: OpenFileRouter.requestNewWindow)) { _ in
                guard openRouter.hasPending else { return }
                if canReuseCurrentDocument {
                    consumePendingFileIfNeeded()
                } else if openRouter.claimNewWindow() {
                    openWindow(id: "document")
                }
            }
    }

    /// 空文档或仅欢迎页时可直接载入；已有关联文件 / 未保存编辑则开新窗。
    private var canReuseCurrentDocument: Bool {
        document.fileURL == nil && !document.isDirty
    }

    private func consumePendingFileIfNeeded() {
        guard canReuseCurrentDocument else { return }
        guard let url = openRouter.dequeue() else { return }
        _ = document.load(from: url)
    }

    private func openIncomingFile(_ url: URL) {
        if canReuseCurrentDocument {
            _ = document.load(from: url)
        } else {
            OpenFileRouter.shared.enqueue([url])
            openWindow(id: "document")
        }
    }
}

struct EquiCommands: Commands {
    @FocusedObject private var document: DocumentModel?
    @FocusedObject private var commands: EditorCommandBus?
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("新建") {
                openWindow(id: "document")
            }
            .keyboardShortcut("n", modifiers: .command)

            Button("打开…") {
                document?.openDocument()
            }
            .keyboardShortcut("o", modifiers: .command)
            .disabled(document == nil)
        }

        CommandGroup(replacing: .saveItem) {
            Button("存储") {
                _ = document?.save()
            }
            .keyboardShortcut("s", modifiers: .command)
            .disabled(document == nil)

            Button("存储为…") {
                _ = document?.saveAs()
            }
            .keyboardShortcut("s", modifiers: [.command, .shift])
            .disabled(document == nil)
        }

        CommandGroup(replacing: .undoRedo) {
            Button("撤销") {
                commands?.undo()
            }
            .keyboardShortcut("z", modifiers: .command)
            .disabled(commands == nil)

            Button("重做") {
                commands?.redo()
            }
            .keyboardShortcut("z", modifiers: [.command, .shift])
            .disabled(commands == nil)
        }
    }
}
