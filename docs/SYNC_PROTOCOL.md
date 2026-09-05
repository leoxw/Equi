# 双向同步协议详解

## 状态机

```
                 focus source
              ┌────────────────┐
              ▼                │
         ┌─────────┐     ┌─────────┐
  none ←─┤ source  │     │ wysiwyg │─→ none (双方 blur)
         └────┬────┘     └────┬────┘
              │                ▲
              │   focus wysiwyg│
              └────────────────┘
```

| `sourceOfTruth` | 左栏 onChange | 右栏 onUpdate | 滚动同步 |
|-----------------|---------------|---------------|----------|
| `source` | → 解析 MD → 静默写 TipTap + 上报 Swift | **忽略** | 左驱动右 |
| `wysiwyg` | **忽略** | → 导出 MD → 静默写 CM + 上报 Swift | 右驱动左 |
| `none` | 允许（外部注入后） | 允许 | 双向 |

## Sync Lock

```
onSourceChange:
  if syncLock or sourceOfTruth == 'wysiwyg': return
  debounce 120ms
  syncLock = true
  wysiwyg.setHtmlSilent(markdownToHtml(md))
  emitToSwift(md)
  rAF → syncLock = false
```

右→左对称。`setHtmlSilent` / `setMarkdownSilent` 内部再设 `suppressChange`，避免编辑器自身的 update 监听在锁释放前再次入队。

## 光标与选区

- **活跃侧**：只接收用户输入，不对自身做 `setValue`；选区自然稳定
- **非活跃侧**：静默 `dispatch` / `setContent` 时带上原 `selection`，由 CM / PM 夹紧越界位置；**不调用 focus**

## 滚动

```
ratio = scrollTop / (scrollHeight - clientHeight)
```

对侧 `setScrollRatio`；`scrollLock` 双 rAF 解锁，并带 `SCROLL_SYNC_EPS` 抑制微抖动互踢。

## 防抖

`DEBOUNCE_MS = 120`。大文档可调到 200–300。Swift 侧打开文件走 `setMarkdownFromNative({ immediate 语义 })`，同步引擎内 `immediate` 路径跳过防抖。

## 与原生 dirty / revision

- Web 每次 `contentChange` 上报 `dirty = (markdown !== baselineMarkdown)`
- Swift `replaceContent` 递增 `nativeRevision`；Coordinator 仅在 revision 变化时 `EditorAPI.setMarkdown`
- 保存成功后 Swift 将 `isDirty = false`；可再调 `EditorAPI.markClean()` 对齐 Web baseline（当前保存后下次编辑会再次上报 dirty，行为正确）
