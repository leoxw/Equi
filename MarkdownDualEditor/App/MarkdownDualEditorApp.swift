import SwiftUI

@main
struct MarkdownDualEditorApp: App {
    @StateObject private var document = DocumentModel()
    @StateObject private var commands = EditorCommandBus()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(document)
                .environmentObject(commands)
                .frame(minWidth: 880, minHeight: 560)
                .background(WindowChromeConfigurator())
        }
        .windowStyle(.automatic)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("新建") { document.newDocument() }
                    .keyboardShortcut("n", modifiers: .command)

                Button("打开…") { document.openDocument() }
                    .keyboardShortcut("o", modifiers: .command)
            }

            CommandGroup(replacing: .saveItem) {
                Button("存储") { _ = document.save() }
                    .keyboardShortcut("s", modifiers: .command)

                Button("存储为…") { _ = document.saveAs() }
                    .keyboardShortcut("s", modifiers: [.command, .shift])
            }

            CommandGroup(replacing: .undoRedo) {
                Button("撤销") {
                    NotificationCenter.default.post(name: .editorUndo, object: nil)
                }
                .keyboardShortcut("z", modifiers: .command)

                Button("重做") {
                    NotificationCenter.default.post(name: .editorRedo, object: nil)
                }
                .keyboardShortcut("z", modifiers: [.command, .shift])
            }
        }
    }
}

extension Notification.Name {
    static let editorUndo = Notification.Name("MarkdownDualEditor.undo")
    static let editorRedo = Notification.Name("MarkdownDualEditor.redo")
}
