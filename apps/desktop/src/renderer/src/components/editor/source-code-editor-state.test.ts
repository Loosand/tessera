/**
 * [INPUT]: 源码编辑器会话快照和目标行号的边界值
 * [OUTPUT]: CodeMirror 文档切换与跳行协议的回归保障
 * [POS]: 源码编辑器纯状态协议单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  clampSourceEditorSession,
  consumePendingSourceEditorLine,
  normalizeSourceEditorLine,
  queueSourceEditorLine,
} from "./source-code-editor-state"

describe("CodeMirror source editor state", () => {
  it("恢复文档时把选区限制在新文档边界内", () => {
    expect(
      clampSourceEditorSession(
        {
          anchor: 120,
          head: -5,
          scrollTop: 360,
        },
        80,
      ),
    ).toEqual({ anchor: 80, head: 0, scrollTop: 360 })
  })

  it("未知文档与非法快照回退到安全起点", () => {
    expect(clampSourceEditorSession(undefined, 100_000)).toEqual({ anchor: 0, head: 0, scrollTop: 0 })
    expect(
      clampSourceEditorSession({ anchor: Number.NaN, head: Number.POSITIVE_INFINITY, scrollTop: -20 }, 200),
    ).toEqual({ anchor: 0, head: 0, scrollTop: 0 })
  })

  it("源码跳转始终使用一基准整数行号", () => {
    expect(normalizeSourceEditorLine(8.9)).toBe(8)
    expect(normalizeSourceEditorLine(0)).toBe(1)
    expect(normalizeSourceEditorLine(Number.NaN)).toBe(1)
  })

  it("按需加载期间只保留最后一个待处理跳行请求", () => {
    queueSourceEditorLine(4)
    queueSourceEditorLine(12)
    expect(consumePendingSourceEditorLine()).toBe(12)
    expect(consumePendingSourceEditorLine()).toBeNull()
  })
})
