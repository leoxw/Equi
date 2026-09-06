import Foundation
import Combine

/// 原生菜单 / 工具栏 → Web 编辑器的命令总线。
@MainActor
final class EditorCommandBus: ObservableObject {
    enum Command {
        case undo
        case redo
        case focusSource
        case focusWysiwyg
        case zoomIn
        case zoomOut
        case zoomReset
        case toggleOutline
    }

    /// 递增序号，保证相同命令也能被 Combine 再次投递。
    @Published private(set) var ticket: (UInt64, Command)?
    private var seq: UInt64 = 0

    func send(_ command: Command) {
        seq &+= 1
        ticket = (seq, command)
    }

    func undo() { send(.undo) }
    func redo() { send(.redo) }
    func focusSource() { send(.focusSource) }
    func focusWysiwyg() { send(.focusWysiwyg) }
    func zoomIn() { send(.zoomIn) }
    func zoomOut() { send(.zoomOut) }
    func zoomReset() { send(.zoomReset) }
    func toggleOutline() { send(.toggleOutline) }
}
