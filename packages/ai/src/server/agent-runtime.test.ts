/**
 * [INPUT]: 轻量 Agent 指令、工作区请求相关性、外部 MCP 工具、联网搜索预算耗尽与 AI SDK 审批适配
 * [OUTPUT]: 精简提示词、工作区能力相关性、搜索预算工具错误续答和 MCP 强制审批回归
 * [POS]: @tessera/ai/server 轻量 Agent 编排协议单元测试
 * [DOC]: docs/architecture/agent-simplification-roadmap.md、docs/architecture/mcp.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  agentInstructions,
  canCompleteAfterWebSearchBudget,
  createExternalAgentToolSet,
  webSearchBudgetToolErrorChunk,
  workspaceAccessRelevant,
} from "./agent-runtime"

describe("轻量 Agent 指令", () => {
  it("只描述通用角色、当前环境和文件能力边界", () => {
    const instructions = agentInstructions("示例工作区", "notes/current.md")

    expect(instructions).toContain("当前工作区：示例工作区")
    expect(instructions).toContain("当前文档：notes/current.md")
    expect(instructions).toContain("修改前先 read")
    expect(instructions).not.toContain("create-document")
    expect(instructions).not.toContain("publish-research-plan")
    expect(instructions).not.toContain("finalize-research")
    expect(instructions).not.toContain("审批")
    expect(instructions.length).toBeLessThan(700)
  })
})

describe("工作区工具相关性", () => {
  it("公开网页问题不因为任务绑定工作区就暴露本地工具", () => {
    expect(
      workspaceAccessRelevant([
        {
          id: "user-public",
          role: "user",
          parts: [{ type: "text", text: "《贵族生活》有哪些歌，双方分别负责什么？" }],
        },
      ]),
    ).toBe(false)
  })

  it("明确工作区请求、Markdown 附件和承接本地工具结果时保持授权", () => {
    expect(
      workspaceAccessRelevant([
        {
          id: "user-workspace",
          role: "user",
          parts: [{ type: "text", text: "请检查工作区里的研究文档" }],
        },
      ]),
    ).toBe(true)
    expect(
      workspaceAccessRelevant(
        [
          {
            id: "user-follow-up",
            role: "user",
            parts: [{ type: "text", text: "继续说明第二点" }],
          },
        ],
        "notes/research.md",
      ),
    ).toBe(true)
    expect(
      workspaceAccessRelevant([
        {
          id: "user-first",
          role: "user",
          parts: [{ type: "text", text: "检查本地材料" }],
        },
        {
          id: "assistant-read",
          role: "assistant",
          parts: [
            {
              type: "tool-read",
              toolCallId: "read-1",
              state: "output-available",
              input: { path: "notes/research.md" },
              output: { content: "证据" },
            },
          ],
        },
        {
          id: "user-follow-up",
          role: "user",
          parts: [{ type: "text", text: "那第二点呢？" }],
        },
      ]),
    ).toBe(true)
  })

  it("识别无需重复说工作区的测试、构建与包管理命令", () => {
    for (const text of ["跑一下测试", "执行 bun test", "运行构建", "run the tests", "pnpm typecheck"]) {
      expect(
        workspaceAccessRelevant([
          {
            id: `user-execution-${text}`,
            role: "user",
            parts: [{ type: "text", text }],
          },
        ]),
      ).toBe(true)
    }
    expect(
      workspaceAccessRelevant([
        {
          id: "user-concept",
          role: "user",
          parts: [{ type: "text", text: "Bash 的运行原理是什么？" }],
        },
      ]),
    ).toBe(false)
  })
})

describe("外部 MCP Agent 工具", () => {
  it("不论服务器 annotations 都固定要求人工审批", () => {
    const tools = createExternalAgentToolSet(
      [
        {
          id: "mcp__test__search",
          title: "Test / search",
          description: "搜索外部数据",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({ ok: true }),
        },
      ],
      new AbortController().signal,
    )

    expect(tools.mcp__test__search?.needsApproval).toBe(true)
  })
})

describe("联网搜索预算耗尽", () => {
  it("降级为标准工具错误，并在预算后正文完整结束时允许正常完成", () => {
    expect(webSearchBudgetToolErrorChunk("search-6")).toMatchObject({
      type: "tool-output-error",
      toolCallId: "search-6",
      providerExecuted: true,
      failure: {
        code: "execution",
        retryable: false,
        toolCallId: "search-6",
        toolName: "web_search",
      },
    })
    expect(canCompleteAfterWebSearchBudget("使用已有五次搜索结果完成的答案。", true)).toBe(true)
    expect(canCompleteAfterWebSearchBudget("未完成", false)).toBe(false)
    expect(canCompleteAfterWebSearchBudget("   ", true)).toBe(false)
  })
})
