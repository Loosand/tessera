/**
 * [INPUT]: 编辑器内容同步控制器与 Vitest 假时钟
 * [OUTPUT]: 延迟合并、IME 暂停、文档身份保持和强制提交的回归保障
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

  it("中文 IME 组合期间不读取中间态，结束后只提交最终文本", () => {
    vi.useFakeTimers()
    let compositionText = ""
    const readContent = vi.fn(() => compositionText)
    const onContentChange = vi.fn()
    const controller = createEditorContentSyncController(300)

    controller.pause()
    for (const text of ["n", "ni", "你"]) {
      compositionText = text
      controller.schedule({ documentPath: "中文.md", readContent, onContentChange })
      vi.advanceTimersByTime(500)
    }

    expect(readContent).not.toHaveBeenCalled()
    expect(onContentChange).not.toHaveBeenCalled()

    controller.resume()
    vi.advanceTimersByTime(299)
    expect(onContentChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onContentChange).toHaveBeenCalledWith("中文.md", "你")
    expect(readContent).toHaveBeenCalledTimes(1)
  })

  it("显式 flush 在 IME 暂停期间仍提交当前内容", () => {
    vi.useFakeTimers()
    const onContentChange = vi.fn()
    const controller = createEditorContentSyncController()

    controller.pause()
    controller.schedule({
      documentPath: "note.md",
      readContent: () => "当前组合内容",
      onContentChange,
    })
    controller.flush()

    expect(onContentChange).toHaveBeenCalledWith("note.md", "当前组合内容")
  })
})
