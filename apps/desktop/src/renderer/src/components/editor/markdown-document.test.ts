/**
 * [INPUT]: Markdown 文档拆分、重组函数与编辑器统一扩展
 * [OUTPUT]: frontmatter 及常用块级结构的自动化往返保障
 * [POS]: Markdown 文件契约的回归测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { MarkdownManager } from "@tiptap/markdown"
import { describe, expect, it } from "vitest"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import { joinMarkdownDocument, splitMarkdownDocument } from "./markdown-document"

const markdownManager = new MarkdownManager({
  extensions: EDITOR_EXTENSIONS,
  markedOptions: {
    breaks: false,
    gfm: true,
  },
})

function roundTrip(markdown: string) {
  const document = splitMarkdownDocument(markdown)
  const parsed = markdownManager.parse(document.body)
  return joinMarkdownDocument(document.frontmatter, markdownManager.serialize(parsed))
}

describe("Markdown 文档边界", () => {
  it("不把正文中的分隔线误认为 frontmatter", () => {
    const markdown = "开头\n\n---\n\n结尾"
    expect(splitMarkdownDocument(markdown)).toEqual({ frontmatter: null, body: markdown })
  })

  it("拆分时规范化 frontmatter 换行并保留正文", () => {
    expect(splitMarkdownDocument("---\r\ntitle: 示例\r\ntags:\r\n  - 本地\r\n---\r\n\r\n# 正文")).toEqual({
      frontmatter: "---\ntitle: 示例\ntags:\n  - 本地\n---",
      body: "# 正文",
    })
  })

  it("空正文仍保留完整 frontmatter", () => {
    expect(joinMarkdownDocument("---\ntitle: 空文档\n---", "")).toBe("---\ntitle: 空文档\n---\n")
  })
})

describe("Markdown 编辑器往返", () => {
  it("保留 frontmatter 并往返常用格式", () => {
    const result = roundTrip(`---
title: 示例
private: true
---

# 一级标题

这是 **粗体**、[链接](https://example.com) 和 \`代码\`。

- [x] 已完成
- [ ] 待处理

> 引用内容`)

    expect(result).toContain("---\ntitle: 示例\nprivate: true\n---")
    expect(result).toContain("# 一级标题")
    expect(result).toContain("**粗体**")
    expect(result).toContain("[链接](https://example.com)")
    expect(result).toContain("- [x] 已完成")
    expect(result).toContain("> 引用内容")
  })

  it("往返 GFM 表格及单元格对齐", () => {
    const result = roundTrip(`| 名称 | 状态 | 备注 |
| :--- | :---: | ---: |
| 工作区 | 完成 | 本地 |
| 编辑器 | 进行中 | Markdown |`)

    expect(result).toContain("| 名称")
    expect(result).toContain("| 工作区")
    expect(result).toContain(":---")
    expect(result).toContain("---:")
  })
})
