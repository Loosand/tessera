/**
 * [INPUT]: 包含未闭合强调、CJK、链接、表格、数学公式和原始 HTML 的静态/流式 Markdown 示例
 * [OUTPUT]: Streamdown 统一渲染器的语义、增量修复、尾部缓冲边界、富内容控件和安全边界回归验证
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
    expect(markup).toContain('data-streamdown="strong">解构请求</span>')
    expect(markup).toContain('data-streamdown="strong">主题</span>')
    expect(markup).not.toContain("**解构请求**")
  })

  it("为链接保留新窗口安全属性", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown>{"[来源](https://example.com) [危险](javascript:alert(1))"}</ChatMarkdown>,
    )

    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noreferrer"')
    expect(markup).not.toContain('href="javascript:')
  })

  it("以完整圆角外框包裹可横向滚动的表格", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown>{"| 时间 | 事件 |\n| --- | --- |\n| 2025 年 12 月 1 日 | 发布新模型 |"}</ChatMarkdown>,
    )

    expect(markup).toContain('data-streamdown="table-wrapper"')
    expect(markup).toContain('data-streamdown="table"')
    expect(markup).toContain('data-streamdown="table-header-cell"')
    expect(markup).toContain('data-streamdown="table-cell"')
    expect(markup).toContain("max-height:360px")
    expect(markup).toContain('title="复制表格"')
    expect(markup).toContain('title="下载表格"')
    expect(markup).toContain('title="全屏查看"')
  })

  it("只把工作区内 Markdown 相对链接解析为可跳转引用", () => {
    expect(parseWorkspaceReference("docs/architecture/editor.md#L42")).toEqual({
      path: "docs/architecture/editor.md",
      line: 42,
    })
    expect(parseWorkspaceReference("../secret.md#L1")).toBeNull()
    expect(parseWorkspaceReference("https://example.com/readme.md#L1")).toBeNull()
  })

  it("流式修复未闭合的 CJK 强调并只保留尾部光标", () => {
    const markup = renderToStaticMarkup(<ChatMarkdown streaming>{"中文里的**重点"}</ChatMarkdown>)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('data-streaming="true"')
    expect(markup).toContain('data-streamdown="strong"')
    expect(markup).not.toContain("data-sd-animate")
    expect(markup).toContain("--streamdown-caret")
    expect(markup).not.toContain("**重点")
  })

  it("渲染 KaTeX 数学公式并拒绝原始 HTML", () => {
    const mathMarkup = renderToStaticMarkup(<ChatMarkdown>{"公式：$$E = mc^2$$"}</ChatMarkdown>)
    const htmlMarkup = renderToStaticMarkup(
      <ChatMarkdown>{'<script>alert("x")</script><img src="x" onerror="alert(1)">'}</ChatMarkdown>,
    )

    expect(mathMarkup).toContain("katex")
    expect(mathMarkup).toContain("math")
    expect(htmlMarkup).not.toContain("<script")
    expect(htmlMarkup).not.toContain("<img")
    expect(htmlMarkup).toContain("&lt;script&gt;")
  })

  it("为代码提供操作控件并把 Mermaid 送入延迟图表边界", () => {
    const codeMarkup = renderToStaticMarkup(<ChatMarkdown>{"```ts\nconst answer = 42\n```"}</ChatMarkdown>)
    const mermaidMarkup = renderToStaticMarkup(
      <ChatMarkdown>{"```mermaid\ngraph TD\n  A --> B\n```"}</ChatMarkdown>,
    )

    expect(codeMarkup).toContain('data-streamdown="code-block"')
    expect(codeMarkup).toContain('title="下载文件"')
    expect(codeMarkup).toContain('title="复制代码"')
    expect(mermaidMarkup).toContain("animate-spin")
    expect(mermaidMarkup).not.toContain("graph TD")
  })
})
