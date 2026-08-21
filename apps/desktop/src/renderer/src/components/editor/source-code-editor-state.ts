/**
 * [INPUT]: 源码编辑器文档长度、选区/滚动快照与目标 Markdown 行号
 * [OUTPUT]: 可恢复的安全会话快照和跨组件源码跳行事件
 * [POS]: CodeMirror React 生命周期之外的纯状态与导航协议
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const SOURCE_EDITOR_NAVIGATE_EVENT = "tessera:source-editor-navigate"

export interface SourceEditorSessionSnapshot {
  anchor: number
  head: number
  scrollTop: number
}

export interface SourceEditorNavigateDetail {
  line: number
}

let pendingSourceEditorLine: number | null = null

function clampFinite(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

export function clampSourceEditorSession(
  snapshot: SourceEditorSessionSnapshot | undefined,
  documentLength: number,
): SourceEditorSessionSnapshot {
  const maximumPosition = Math.max(0, Math.floor(documentLength))
  if (!snapshot) return { anchor: 0, head: 0, scrollTop: 0 }

  return {
    anchor: Math.floor(clampFinite(snapshot.anchor, 0, maximumPosition)),
    head: Math.floor(clampFinite(snapshot.head, 0, maximumPosition)),
    scrollTop: clampFinite(snapshot.scrollTop, 0, Number.MAX_SAFE_INTEGER),
  }
}

export function normalizeSourceEditorLine(line: number) {
  if (!Number.isFinite(line)) return 1
  return Math.max(1, Math.floor(line))
}

export function queueSourceEditorLine(line: number) {
  pendingSourceEditorLine = normalizeSourceEditorLine(line)
  return pendingSourceEditorLine
}

export function consumePendingSourceEditorLine() {
  const line = pendingSourceEditorLine
  pendingSourceEditorLine = null
  return line
}

export function requestSourceEditorLine(line: number) {
  const normalizedLine = queueSourceEditorLine(line)
  window.dispatchEvent(
    new CustomEvent<SourceEditorNavigateDetail>(SOURCE_EDITOR_NAVIGATE_EVENT, {
      detail: { line: normalizedLine },
    }),
  )
}
