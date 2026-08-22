/**
 * [INPUT]: AI SDK 动态或具名工具 Part、内容领域审批输入
 * [OUTPUT]: Tool Chips 状态、资源、输入详情、失败原因与正式产物紧凑审批的回归验证
 * [POS]: tool-part 的数据适配与呈现单元测试
 * [DOC]: design.md、docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ToolPart } from "./tool-part"

type ToolMessagePart = Extract<UIMessage["parts"][number], { type: "dynamic-tool" | `tool-${string}` }>

describe("通用工具调用", () => {
  it("以 Tool Chips 呈现执行状态、目标与可展开输入", () => {
    const part = {
      type: "tool-read-workspace-file",
      toolCallId: "read-1",
      state: "input-available",
      input: { path: "docs/readme.md" },
    } as ToolMessagePart
    const markup = renderToStaticMarkup(<ToolPart part={part} />)

    expect(markup).toContain('data-slot="tool-chips"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain("读取工作区文件")
    expect(markup).toContain("docs/readme.md")
    expect(markup).toContain("正在执行")
    expect(markup).toContain("工具输入")
  })

  it("失败时展开并同时呈现状态与错误原因", () => {
    const part = {
      type: "dynamic-tool",
      toolCallId: "call-1",
      toolName: "unknown-tool",
      state: "output-error",
      input: { query: "test" },
      errorText: "连接超时",
    } as ToolMessagePart
    const markup = renderToStaticMarkup(<ToolPart part={part} />)

    expect(markup).toContain('data-state="output-error"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain("执行失败")
    expect(markup).toContain("连接超时")
  })

  it("创建正式文档时显示未归档摘要和截断正文，不回退成原始大 JSON", () => {
    const part = {
      type: "tool-create-document",
      toolCallId: "create-1",
      state: "approval-requested",
      input: {
        title: "玛德琳",
        content: `# 玛德琳\n\n${"正文".repeat(800)}`,
        reason: "用户要求成稿",
      },
      approval: { id: "approval-1", isAutomatic: false },
    } as ToolMessagePart
    const markup = renderToStaticMarkup(<ToolPart part={part} onToolApproval={() => {}} />)

    expect(markup).toContain("创建正式文档「玛德琳」")
    expect(markup).toContain("未归档")
    expect(markup).toContain("正文预览已截断")
    expect(markup).not.toContain("用户要求成稿")
    expect(markup).toContain("允许执行")
  })
})
