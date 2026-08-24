/**
 * [INPUT]: AI SDK 产生的细粒度正文、推理、工具输入 delta 与其他有序流事件
 * [OUTPUT]: 保序且按字符/延迟双阈值合并的 AI Chat 事件，在保持流式反馈的同时降低 IPC、SQLite 与 renderer 压力
 * [POS]: 模型运行流进入主进程持久化与窗口广播前的轻量背压边界
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamChunk, AiChatStreamEvent } from "@tessera/contracts"

type MergeableChunk = Extract<
  AiChatStreamChunk,
  { type: "reasoning-delta" | "text-delta" | "tool-input-delta" }
>

function mergeKey(chunk: MergeableChunk) {
  return chunk.type === "tool-input-delta" ? `${chunk.type}:${chunk.toolCallId}` : `${chunk.type}:${chunk.id}`
}

function deltaLength(chunk: MergeableChunk) {
  return chunk.type === "tool-input-delta" ? chunk.inputTextDelta.length : chunk.delta.length
}

function mergeChunks(current: MergeableChunk, next: MergeableChunk): MergeableChunk {
  if (current.type === "tool-input-delta" && next.type === "tool-input-delta") {
    return { ...current, inputTextDelta: current.inputTextDelta + next.inputTextDelta }
  }
  if (current.type === "reasoning-delta" && next.type === "reasoning-delta") {
    return { ...current, delta: current.delta + next.delta }
  }
  if (current.type === "text-delta" && next.type === "text-delta") {
    return { ...current, delta: current.delta + next.delta }
  }
  throw new Error("不能合并不同类型的 AI 流增量。")
}

function isMergeableChunk(chunk: AiChatStreamChunk): chunk is MergeableChunk {
  return chunk.type === "reasoning-delta" || chunk.type === "text-delta" || chunk.type === "tool-input-delta"
}

export class AiChatChunkCoalescer {
  private pending: MergeableChunk | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private operation = Promise.resolve()

  constructor(
    private readonly emit: (chunk: AiChatStreamChunk) => void | Promise<void>,
    private readonly maxCharacters = 160,
    private readonly maxLatencyMs = 50,
  ) {}

  push(chunk: AiChatStreamChunk) {
    return this.enqueue(() => this.pushNow(chunk))
  }

  flush() {
    return this.enqueue(() => this.flushNow())
  }

  private enqueue(operation: () => void | Promise<void>) {
    const next = this.operation.then(operation)
    this.operation = next.catch(() => {})
    return next
  }

  private async pushNow(chunk: AiChatStreamChunk) {
    if (!isMergeableChunk(chunk)) {
      await this.flushNow()
      await this.emit(chunk)
      return
    }
    if (this.pending && mergeKey(this.pending) === mergeKey(chunk)) {
      this.pending = mergeChunks(this.pending, chunk)
    } else {
      await this.flushNow()
      this.pending = chunk
    }
    if (this.pending && deltaLength(this.pending) >= this.maxCharacters) {
      await this.flushNow()
      return
    }
    this.scheduleFlush()
  }

  private scheduleFlush() {
    if (this.flushTimer || !this.pending) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.enqueue(() => this.flushNow())
    }, this.maxLatencyMs)
  }

  private async flushNow() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const pending = this.pending
    if (!pending) return
    this.pending = null
    await this.emit(pending)
  }
}

export async function coalesceAiChatEvents(events: readonly AiChatStreamEvent[], maxCharacters = 160) {
  const first = events[0]
  if (!first) return []
  const coalesced: AiChatStreamEvent[] = []
  const chunks = new AiChatChunkCoalescer((chunk) => {
    const sequence = coalesced.length + 1
    coalesced.push({
      taskId: first.taskId,
      requestId: first.requestId,
      sequence,
      chunk,
    })
  }, maxCharacters)
  for (const event of events) await chunks.push(event.chunk)
  await chunks.flush()
  return coalesced
}
