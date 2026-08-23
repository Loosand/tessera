/**
 * [INPUT]: 细粒度且交错的正文、推理、工具输入和终止事件
 * [OUTPUT]: delta 合并阈值、跨类型保序和尾部刷新行为的回归验证
 * [POS]: 主进程 AI Chat 流背压边界的确定性单元测试
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamChunk, AiChatStreamEvent } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { AiChatChunkCoalescer, coalesceAiChatEvents } from "./ai-chat-chunk-coalescer"

describe("AiChatChunkCoalescer", () => {
  it("把同一正文增量合并到阈值，并在终止事件前刷新尾部", async () => {
    const chunks: AiChatStreamChunk[] = []
    const coalescer = new AiChatChunkCoalescer((chunk) => {
      chunks.push(chunk)
    }, 5)

    await coalescer.push({ type: "text-delta", id: "text-1", delta: "你" })
    await coalescer.push({ type: "text-delta", id: "text-1", delta: "好呀" })
    expect(chunks).toEqual([])
    await coalescer.push({ type: "text-delta", id: "text-1", delta: "世界" })
    await coalescer.push({ type: "finish", finishReason: "stop" })

    expect(chunks).toEqual([
      { type: "text-delta", id: "text-1", delta: "你好呀世界" },
      { type: "finish", finishReason: "stop" },
    ])
  })

  it("不同 ID、类型与工具调用之间保持原始顺序", async () => {
    const chunks: AiChatStreamChunk[] = []
    const coalescer = new AiChatChunkCoalescer((chunk) => {
      chunks.push(chunk)
    })

    await coalescer.push({ type: "reasoning-delta", id: "reasoning-1", delta: "先" })
    await coalescer.push({ type: "reasoning-delta", id: "reasoning-1", delta: "想" })
    await coalescer.push({
      type: "tool-input-delta",
      toolCallId: "tool-1",
      inputTextDelta: '{"q":',
    })
    await coalescer.push({
      type: "tool-input-delta",
      toolCallId: "tool-1",
      inputTextDelta: '"FKJ"}',
    })
    await coalescer.flush()

    expect(chunks).toEqual([
      { type: "reasoning-delta", id: "reasoning-1", delta: "先想" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"q":"FKJ"}' },
    ])
  })

  it("压缩历史重放事件并重新生成连续序号", async () => {
    const events = [
      { type: "start", messageId: "assistant" },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: "a" },
      { type: "text-delta", id: "answer", delta: "b" },
      { type: "text-end", id: "answer" },
      { type: "finish", finishReason: "stop" },
    ].map(
      (chunk, index) =>
        ({
          taskId: "task",
          requestId: "request",
          sequence: index + 10,
          chunk,
        }) as AiChatStreamEvent,
    )
    const result = await coalesceAiChatEvents(events)
    expect(result.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(result[2]?.chunk).toEqual({ type: "text-delta", id: "answer", delta: "ab" })
  })
})
