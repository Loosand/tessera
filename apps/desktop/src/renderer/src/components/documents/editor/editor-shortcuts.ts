/**
 * [INPUT]: 文档编辑表面的键盘事件修饰键、按键与 IME composition 状态
 * [OUTPUT]: 保存、模式切换或交还浏览器/TipTap 处理的快捷键意图
 * [POS]: 全局文档快捷键与编辑器原生输入、撤销行为之间的仲裁层
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type EditorShortcut = "save" | "toggle-mode"

export interface EditorShortcutEvent {
  ctrlKey: boolean
  isComposing?: boolean
  key: string
  metaKey: boolean
}

export function resolveEditorShortcut(event: EditorShortcutEvent): EditorShortcut | null {
  if (event.isComposing || (!event.metaKey && !event.ctrlKey)) return null

  const key = event.key.toLowerCase()
  if (key === "s") return "save"
  if (key === "/") return "toggle-mode"
  return null
}
