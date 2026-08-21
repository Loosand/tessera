/**
 * [INPUT]: 编辑器内容读取器、文档身份、草稿回调与延迟时长
 * [OUTPUT]: 可调度、暂停、恢复、强制提交和取消的编辑器内容同步控制器
 * [POS]: 编辑器本地交易、IME composition 与 React 草稿提交之间的时间调度边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const EDITOR_CONTENT_SYNC_DELAY_MS = 300

export interface PendingEditorContentSync {
  documentPath: string
  readContent: () => string
  onContentChange: (documentPath: string, content: string) => void
}

export interface EditorContentSyncController {
  cancel: () => void
  flush: () => void
  hasPending: () => boolean
  pause: () => void
  resume: () => void
  schedule: (pendingSync: PendingEditorContentSync) => void
}

export function createEditorContentSyncController(
  delay = EDITOR_CONTENT_SYNC_DELAY_MS,
): EditorContentSyncController {
  let pendingSync: PendingEditorContentSync | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let paused = false

  const clearTimer = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const flush = () => {
    clearTimer()
    const currentSync = pendingSync
    pendingSync = null
    if (!currentSync) return
    currentSync.onContentChange(currentSync.documentPath, currentSync.readContent())
  }

  const scheduleFlush = () => {
    if (paused || !pendingSync) return
    timer = setTimeout(flush, delay)
  }

  return {
    cancel: () => {
      clearTimer()
      pendingSync = null
    },
    flush,
    hasPending: () => pendingSync !== null,
    pause: () => {
      paused = true
      clearTimer()
    },
    resume: () => {
      if (!paused) return
      paused = false
      scheduleFlush()
    },
    schedule: (nextSync) => {
      pendingSync = nextSync
      clearTimer()
      scheduleFlush()
    },
  }
}
