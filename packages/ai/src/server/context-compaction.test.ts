/**
 * [INPUT]: 超预算 ModelMessage、跨工具并发完成顺序与最近用户 turn
 * [OUTPUT]: compaction marker、保留尾部、工具配对安全和源序 ToolResult 回归
 * [POS]: context-compaction 的纯逻辑稳定性测试
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { canonicalizeToolResultOrder, compactTaskModelMessages } from "./context-compaction"

describe("上下文压缩投影", () => {
  it("保留最新用户 turn，只压缩模型投影且不把工具输出伪造成事实", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: `旧目标${"甲".repeat(1_200)}` },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "write-1", toolName: "write", input: { path: "a.md" } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "write-1",
            toolName: "write",
            output: { type: "json", value: { status: "saved", secretBody: "不得进入摘要" } },
          },
        ],
      },
      { role: "assistant", content: `旧回答${"乙".repeat(1_000)}` },
      { role: "user", content: "当前真正请求" },
      { role: "assistant", content: "正在处理当前请求" },
    ]

    const projection = compactTaskModelMessages({
      availableInputTokens: 1_100,
      estimatedTokensBefore: 4_000,
      fixedTokens: 200,
      messages,
    })

    expect(projection.compaction).toMatchObject({
      reason: "threshold",
      sourceMessageCount: 6,
    })
    expect(projection.messages[0]).toMatchObject({ role: "user" })
    expect(JSON.stringify(projection.messages[0])).toContain("上下文压缩摘要")
    expect(JSON.stringify(projection.messages[0])).not.toContain("不得进入摘要")
    expect(projection.messages).toContainEqual({ role: "user", content: "当前真正请求" })
    expect(messages).toHaveLength(6)
  })

  it("最新 turn 自身超预算时拒绝破坏消息语法，由预算错误负责停止", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "旧问题" },
      { role: "assistant", content: "旧答案" },
      { role: "user", content: "新".repeat(4_000) },
    ]
    const projection = compactTaskModelMessages({
      availableInputTokens: 800,
      estimatedTokensBefore: 4_500,
      fixedTokens: 300,
      messages,
    })

    expect(projection.compaction).toBeNull()
    expect(projection.messages).toEqual(messages)
  })
})

describe("并行工具结果源序", () => {
  it("UI 可以按完成顺序更新，但下一模型输入按 tool-call 顺序排列", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "slow", toolName: "read", input: { path: "slow.md" } },
          { type: "tool-call", toolCallId: "fast", toolName: "read", input: { path: "fast.md" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "fast",
            toolName: "read",
            output: { type: "text", value: "fast" },
          },
          {
            type: "tool-result",
            toolCallId: "slow",
            toolName: "read",
            output: { type: "text", value: "slow" },
          },
        ],
      },
    ]

    const ordered = canonicalizeToolResultOrder(messages)
    expect(ordered[1]?.content).toMatchObject([{ toolCallId: "slow" }, { toolCallId: "fast" }])
    expect((messages[1]?.content as Array<{ toolCallId: string }>)[0]?.toolCallId).toBe("fast")
  })
})
