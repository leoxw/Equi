import SwiftUI
import AppKit

@main
struct EquiApp: App {
    var body: some Scene {
        // 每个窗口/标签页各自一份 DocumentWorkspaceView → 各自独立 DocumentModel
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
    }
}

/// 单个窗口的根视图：文档与命令总线按窗口隔离，避免多标签共用一份状态。
struct DocumentWorkspaceView: View {
    @StateObject private var document = DocumentModel()
    @StateObject private var commands = EditorCommandBus()

    var body: some View {
        ContentView()
            .environmentObject(document)
            .environmentObject(commands)
            .focusedSceneObject(document)
            .focusedSceneObject(commands)
    }
}

/// 菜单命令作用于「当前焦点窗口」的文档，而不是全局单例。
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
