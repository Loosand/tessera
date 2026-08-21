/**
 * [INPUT]: AI SDK 动态或具名工具 Part
 * [OUTPUT]: Tool Chips 状态、资源、输入详情与失败原因的回归验证
 * [POS]: tool-part 的数据适配与呈现单元测试
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
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
})
