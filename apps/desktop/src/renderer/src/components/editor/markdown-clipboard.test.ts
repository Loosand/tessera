/**
 * [INPUT]: 连续顶层区块剪贴板适配、真实编辑器 schema 与 Markdown 语料
 * [OUTPUT]: 范围序列化、反向选择和剪贴板失败安全的回归测试
 * [POS]: 跨块系统剪贴板的无 DOM 自动化保障
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { getSchema } from "@tiptap/core"
import { MarkdownManager } from "@tiptap/markdown"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { describe, expect, it } from "vitest"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import {
  resolveMarkdownClipboardShortcut,
  serializeTopLevelBlockRangeToMarkdown,
  writeTopLevelBlockRangeToClipboard,
} from "./markdown-clipboard"

const schema = getSchema(EDITOR_EXTENSIONS)
const markdownManager = new MarkdownManager({
  extensions: EDITOR_EXTENSIONS,
  markedOptions: { breaks: false, gfm: true },
})

function parse(markdown: string) {
  return schema.nodeFromJSON(markdownManager.parse(markdown))
}

function topLevelPosition(doc: ProseMirrorNode, index: number) {
  let position = 0
  for (let current = 0; current < index; current += 1) position += doc.child(current).nodeSize
  return position
}

describe("markdown-clipboard", () => {
  it("只在非 IME 的 Mod+C 与 Mod+X 上接管区块剪贴板", () => {
    expect(resolveMarkdownClipboardShortcut({ key: "c", metaKey: true })).toBe("copy")
    expect(resolveMarkdownClipboardShortcut({ key: "X", ctrlKey: true })).toBe("cut")
    expect(resolveMarkdownClipboardShortcut({ key: "c", metaKey: true, shiftKey: true })).toBeNull()
    expect(resolveMarkdownClipboardShortcut({ key: "x", metaKey: true, isComposing: true })).toBeNull()
    expect(resolveMarkdownClipboardShortcut({ key: "v", metaKey: true })).toBeNull()
  })

  it("把列表与引用连续范围复制为独立 Markdown", () => {
    const doc = parse("开头\n\n- 第一项\n- 第二项\n\n> 引用\n\n结尾")
    const listPos = topLevelPosition(doc, 1)
    const quotePos = topLevelPosition(doc, 2)

    expect(serializeTopLevelBlockRangeToMarkdown(markdownManager, doc, listPos, quotePos)).toBe(
      "- 第一项\n- 第二项\n\n> 引用",
    )
    expect(serializeTopLevelBlockRangeToMarkdown(markdownManager, doc, quotePos, listPos)).toBe(
      "- 第一项\n- 第二项\n\n> 引用",
    )
  })

  it("沿用表格序列化规则保留单元格中的文本管道符", () => {
    const doc = parse("之前\n\n| 内容 |\n| --- |\n| a \\| b |\n\n之后")
    const tablePos = topLevelPosition(doc, 1)

    expect(serializeTopLevelBlockRangeToMarkdown(markdownManager, doc, tablePos, tablePos)).toContain(
      "a \\| b",
    )
  })

  it("只有剪贴板成功写入后才报告 copied", async () => {
    const doc = parse("第一段\n\n第二段")
    let written = ""
    const copied = await writeTopLevelBlockRangeToClipboard(markdownManager, doc, 0, 0, async (markdown) => {
      written = markdown
    })
    const failed = await writeTopLevelBlockRangeToClipboard(markdownManager, doc, 0, 0, async () => {
      throw new Error("clipboard denied")
    })
    const invalid = await writeTopLevelBlockRangeToClipboard(markdownManager, doc, 1, 1, async () => {
      throw new Error("不应调用")
    })

    expect(copied).toBe("copied")
    expect(written).toBe("第一段")
    expect(failed).toBe("failed")
    expect(invalid).toBe("invalid-range")
  })
})
