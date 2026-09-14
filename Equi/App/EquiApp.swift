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
            // 不用 onChange(of:perform:)：Xcode 26 / 新 SDK 已移除单参数形式
            .onReceive(openRouter.$epoch) { _ in
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
                    DocumentWindowTabbing.openTab(using: openWindow, host: NSApp.keyWindow)
                }
            }
    }

    /// 无未保存修改且尚无关联文件时可复用本窗；有未保存修改则开新标签。
    private var canReuseCurrentDocument: Bool {
        !document.isDirty && document.fileURL == nil
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
            DocumentWindowTabbing.openTab(using: openWindow, host: NSApp.keyWindow)
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
                guard let url = DocumentModel.promptCreateNewFile() else { return }
                OpenFileRouter.shared.enqueue([url])
                DocumentWindowTabbing.openTab(using: openWindow, host: NSApp.keyWindow)
            }
            .keyboardShortcut("n", modifiers: .command)

            Button("打开…") {
                guard let url = DocumentModel.promptOpenFile() else { return }
                // 当前文稿有未保存修改：新标签打开，避免冲掉编辑中内容
                if document?.isDirty == true {
                    OpenFileRouter.shared.enqueue([url])
                    DocumentWindowTabbing.openTab(using: openWindow, host: NSApp.keyWindow)
                } else if let document {
                    _ = document.load(from: url)
                } else {
                    OpenFileRouter.shared.enqueue([url])
                    DocumentWindowTabbing.openTab(using: openWindow, host: NSApp.keyWindow)
                }
            }
            .keyboardShortcut("o", modifiers: .command)
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
