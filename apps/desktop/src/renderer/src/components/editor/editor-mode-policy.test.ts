/**
 * [INPUT]: 富文本大文档与 Markdown 兼容性保护策略
 * [OUTPUT]: 性能和内容保真保护边界的回归保障
 * [POS]: 编辑器模式选择策略的单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  RICH_TEXT_DOCUMENT_BLOCK_LIMIT,
  RICH_TEXT_DOCUMENT_CHARACTER_LIMIT,
  estimateMarkdownBlockCount,
  getRichTextEditorGuard,
  shouldGuardRichTextEditor,
} from "./editor-mode-policy"

describe("shouldGuardRichTextEditor", () => {
  it("允许阈值以内的文档进入富文本模式", () => {
    expect(shouldGuardRichTextEditor("a".repeat(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT - 1))).toBe(false)
  })

  it("从阈值开始默认使用源码模式", () => {
    expect(getRichTextEditorGuard("a".repeat(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT))).toEqual({
      kind: "large-document",
    })
  })

  it("高块密度文档未达到字符阈值时也默认使用源码模式", () => {
    const markdown = Array.from({ length: RICH_TEXT_DOCUMENT_BLOCK_LIMIT }, () => "短段").join("\n\n")

    expect(markdown.length).toBeLessThan(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT)
    expect(getRichTextEditorGuard(markdown)).toEqual({
      estimatedBlocks: RICH_TEXT_DOCUMENT_BLOCK_LIMIT,
      kind: "many-blocks",
    })
  })

  it("允许块数阈值以内的密集短文档进入富文本模式", () => {
    const markdown = Array.from({ length: RICH_TEXT_DOCUMENT_BLOCK_LIMIT - 1 }, () => "短段").join("\n\n")

    expect(getRichTextEditorGuard(markdown)).toBeNull()
  })

  it("估算列表和表格结构，但不把围栏代码内容当成独立块", () => {
    const markdown = `开头

- 第一项
- 第二项
| 名称 | 状态 |
| --- | --- |
| 编辑器 | 完成 |

\`\`\`md
- 代码样例一
- 代码样例二
| 代码 | 表格 |
\`\`\``

    expect(estimateMarkdownBlockCount(markdown)).toBe(7)
  })

  it("块数保护忽略 YAML frontmatter 内的列表结构", () => {
    const frontmatterItems = Array.from(
      { length: RICH_TEXT_DOCUMENT_BLOCK_LIMIT },
      (_, index) => `  - 标签 ${index}`,
    ).join("\n")
    const markdown = `---\ntags:\n${frontmatterItems}\n---\n\n正文`

    expect(markdown.length).toBeLessThan(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT)
    expect(getRichTextEditorGuard(markdown)).toBeNull()
  })

  it("字符数保护只计算进入 TipTap 的正文", () => {
    const markdown = `---\nmetadata: ${"x".repeat(RICH_TEXT_DOCUMENT_CHARACTER_LIMIT)}\n---\n\n正文`

    expect(getRichTextEditorGuard(markdown)).toBeNull()
  })

  it("为无法保真往返的语法返回源码保护原因", () => {
    expect(getRichTextEditorGuard("正文[^1]\n\n[^1]: 脚注")).toEqual({
      kind: "source-only-markdown",
      syntax: ["footnote"],
    })
  })
})
