/**
 * [INPUT]: 富文本大文档保护策略
 * [OUTPUT]: 阈值边界的回归保障
 * [POS]: 编辑器模式选择策略的单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { RICH_TEXT_DOCUMENT_CHARACTER_LIMIT, shouldGuardRichTextEditor } from "./editor-mode-policy"

describe("shouldGuardRichTextEditor", () => {
  it("允许阈值以内的文档进入富文本模式", () => {
    expect(shouldGuardRichTextEditor("a".repeat(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT - 1))).toBe(false)
  })

  it("从阈值开始默认使用源码模式", () => {
    expect(shouldGuardRichTextEditor("a".repeat(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT))).toBe(true)
  })
})
