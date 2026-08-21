/**
 * [INPUT]: 包含强调、列表、链接和代码块的对话 Markdown 示例
 * [OUTPUT]: 正文与思考过程共享 Markdown 渲染器的语义回归验证
 * [POS]: chat-parts Markdown 呈现契约的单元测试
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ChatMarkdown, parseWorkspaceReference } from "./chat-markdown"

describe("对话 Markdown", () => {
  it("将思考文本中的强调和列表渲染为语义节点", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown compact>{"1. **解构请求**\n\n* **主题**：张小龙\n* **目标**：形成概述"}</ChatMarkdown>,
    )

    expect(markup).toContain("<ol")
    expect(markup).toContain("<ul")
    expect(markup).toContain("<strong>解构请求</strong>")
    expect(markup).toContain("<strong>主题</strong>")
    expect(markup).not.toContain("**解构请求**")
  })

  it("为链接保留新窗口安全属性", () => {
    const markup = renderToStaticMarkup(<ChatMarkdown>{"[来源](https://example.com)"}</ChatMarkdown>)

    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noreferrer"')
  })

  it("只把工作区内 Markdown 相对链接解析为可跳转引用", () => {
    expect(parseWorkspaceReference("docs/architecture/editor.md#L42")).toEqual({
      path: "docs/architecture/editor.md",
      line: 42,
    })
    expect(parseWorkspaceReference("../secret.md#L1")).toBeNull()
    expect(parseWorkspaceReference("https://example.com/readme.md#L1")).toBeNull()
  })
})
