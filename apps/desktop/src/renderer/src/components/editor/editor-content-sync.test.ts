/**
 * [INPUT]: 编辑器内容同步控制器与 Vitest 假时钟
 * [OUTPUT]: 延迟合并、文档身份保持和强制提交的回归保障
 * [POS]: 编辑器草稿同步协议的单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { createEditorContentSyncController } from "./editor-content-sync"

afterEach(() => {
  vi.useRealTimers()
})

describe("createEditorContentSyncController", () => {
  it("只提交静默期内最后一次编辑", () => {
    vi.useFakeTimers()
    const changes: Array<[string, string]> = []
    const controller = createEditorContentSyncController(300)

    controller.schedule({
      documentPath: "first.md",
      readContent: () => "first",
      onContentChange: (path, content) => changes.push([path, content]),
    })
    vi.advanceTimersByTime(200)
    controller.schedule({
      documentPath: "first.md",
      readContent: () => "second",
      onContentChange: (path, content) => changes.push([path, content]),
    })

    vi.advanceTimersByTime(299)
    expect(changes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([["first.md", "second"]])
  })

  it("强制提交时保留调度时的文档身份", () => {
    vi.useFakeTimers()
    const changes: Array<[string, string]> = []
    const controller = createEditorContentSyncController()

    controller.schedule({
      documentPath: "previous.md",
      readContent: () => "pending content",
      onContentChange: (path, content) => changes.push([path, content]),
    })
    controller.flush()

    expect(changes).toEqual([["previous.md", "pending content"]])
    expect(controller.hasPending()).toBe(false)
    vi.runAllTimers()
    expect(changes).toHaveLength(1)
  })

  it("取消后不再提交内容", () => {
    vi.useFakeTimers()
    const onContentChange = vi.fn()
    const controller = createEditorContentSyncController()

    controller.schedule({
      documentPath: "note.md",
      readContent: () => "content",
      onContentChange,
    })
    controller.cancel()
    vi.runAllTimers()

    expect(onContentChange).not.toHaveBeenCalled()
  })
})
