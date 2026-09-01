/**
 * [INPUT]: 截断工具参数、并行工具终态、审批暂停、取消与 terminal 后迟到 chunk
 * [OUTPUT]: Pi 风格 run/turn/tool 事件收口的决定性回归
 * [POS]: agent-run-event-ledger 生命周期单元测试
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamChunk } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { AgentRunEventLedger } from "./agent-run-event-ledger"

function feed(chunks: readonly AiChatStreamChunk[]) {
  const ledger = new AgentRunEventLedger()
  return chunks.flatMap((chunk) => ledger.accept(chunk))
}

describe("Agent run event ledger", () => {
  it("length/step 结束前把未完成参数收口为未执行的稳定输入错误", () => {
    const chunks = feed([
      { type: "start-step" },
      { type: "tool-input-start", toolCallId: "partial", toolName: "write" },
      { type: "tool-input-delta", toolCallId: "partial", inputTextDelta: '{"path":' },
      { type: "finish-step" },
      { type: "finish", finishReason: "length" },
    ])

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "tool-input-start",
      "tool-input-delta",
      "tool-input-error",
      "finish-step",
      "finish",
    ])
    expect(chunks[3]).toMatchObject({
      failure: { code: "invalid-input", retryable: false, toolName: "write" },
    })
  })

  it("每个已接受工具只保留一个终态，并丢弃 run terminal 后迟到结果", () => {
    const ledger = new AgentRunEventLedger()
    const chunks = [
      ...ledger.accept({
        type: "tool-input-available",
        toolCallId: "read-1",
        toolName: "read",
        input: { path: "a.md" },
      }),
      ...ledger.accept({ type: "tool-output-available", toolCallId: "read-1", output: "ok" }),
      ...ledger.accept({ type: "tool-output-error", toolCallId: "read-1", errorText: "late" }),
      ...ledger.accept({ type: "finish", finishReason: "stop" }),
      ...ledger.accept({ type: "text-delta", id: "late", delta: "不得出现" }),
    ]

    expect(chunks.filter((chunk) => chunk.type.startsWith("tool-output-"))).toHaveLength(1)
    expect(chunks.at(-1)?.type).toBe("finish")
  })

  it("正常 finish 保留等待用户的交互/审批，abort 则明确收口", () => {
    const waiting = feed([
      {
        type: "tool-input-available",
        toolCallId: "question",
        toolName: "request-user-input",
        input: { question: "选择？" },
      },
      { type: "finish", finishReason: "tool-calls" },
    ])
    expect(waiting.map((chunk) => chunk.type)).toEqual(["tool-input-available", "finish"])

    const cancelled = feed([
      {
        type: "tool-input-available",
        toolCallId: "edit-1",
        toolName: "edit",
        input: { path: "a.md" },
      },
      { type: "abort", reason: "用户停止" },
    ])
    expect(cancelled.map((chunk) => chunk.type)).toEqual([
      "tool-input-available",
      "tool-output-error",
      "abort",
    ])
    expect(cancelled[1]).toMatchObject({ failure: { code: "cancelled", retryable: false } })
  })
})
