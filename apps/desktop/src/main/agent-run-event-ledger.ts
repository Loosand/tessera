/**
 * [INPUT]: AI SDK 按时间到达的 step、tool、审批与 run 终止 chunk
 * [OUTPUT]: 单终态、无 terminal 后迟到事件、每个已开始/已接受工具均有结果或明确暂停状态的规范化事件序列
 * [POS]: Agent 流进入 SQLite/IPC 之前的 Pi 风格 run/turn/tool 生命周期防线
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamChunk, TaskToolErrorDataV1 } from "@tessera/contracts"

type ToolCallState = {
  approvalId: string | null
  input: unknown
  name: string
  phase: "started" | "accepted" | "terminal"
  waitingForApproval: boolean
}

const CLIENT_SUSPENSION_TOOLS = new Set(["request-user-input"])

function toolFailure(
  toolCallId: string,
  toolName: string,
  terminal: AiChatStreamChunk["type"],
  incompleteInput: boolean,
): TaskToolErrorDataV1 {
  const cancelled = terminal === "abort"
  const truncated = terminal === "finish" && incompleteInput
  const message = truncated
    ? "模型输出在工具参数完成前结束；工具未执行。"
    : cancelled
      ? "运行已停止；工具没有产生可确认的终态结果。"
      : "运行结束前工具没有产生终态结果；为避免重复副作用，不会自动重试。"
  return {
    code: cancelled ? "cancelled" : incompleteInput ? "invalid-input" : "execution",
    message,
    retryable: false,
    toolCallId,
    toolName,
    version: 1,
  }
}

function isRunTerminal(chunk: AiChatStreamChunk) {
  return chunk.type === "finish" || chunk.type === "abort" || chunk.type === "error"
}

function isToolTerminal(chunk: AiChatStreamChunk) {
  return (
    chunk.type === "tool-input-error" ||
    chunk.type === "tool-output-error" ||
    chunk.type === "tool-output-denied" ||
    (chunk.type === "tool-output-available" && chunk.preliminary !== true)
  )
}

export class AgentRunEventLedger {
  private readonly approvals = new Map<string, string>()
  private readonly tools = new Map<string, ToolCallState>()
  private terminal = false

  accept(chunk: AiChatStreamChunk): AiChatStreamChunk[] {
    if (this.terminal) return []

    if (chunk.type === "tool-input-start") {
      if (!this.tools.has(chunk.toolCallId)) {
        this.tools.set(chunk.toolCallId, {
          approvalId: null,
          input: {},
          name: chunk.toolName,
          phase: "started",
          waitingForApproval: false,
        })
      }
      return [chunk]
    }

    if (chunk.type === "tool-input-available") {
      const state = this.tools.get(chunk.toolCallId)
      if (state?.phase === "terminal") return []
      this.tools.set(chunk.toolCallId, {
        approvalId: state?.approvalId ?? null,
        input: chunk.input,
        name: chunk.toolName,
        phase: "accepted",
        waitingForApproval: state?.waitingForApproval ?? false,
      })
      return [chunk]
    }

    if (chunk.type === "tool-input-error") {
      const state = this.tools.get(chunk.toolCallId)
      if (state?.phase === "terminal") return []
      this.tools.set(chunk.toolCallId, {
        approvalId: state?.approvalId ?? null,
        input: chunk.input,
        name: chunk.toolName,
        phase: "terminal",
        waitingForApproval: false,
      })
      return [chunk]
    }

    if (chunk.type === "tool-approval-request") {
      const state = this.tools.get(chunk.toolCallId)
      if (state) {
        state.approvalId = chunk.approvalId
        state.waitingForApproval = chunk.isAutomatic !== true
      }
      this.approvals.set(chunk.approvalId, chunk.toolCallId)
      return [chunk]
    }

    if (chunk.type === "tool-approval-response") {
      const toolCallId = this.approvals.get(chunk.approvalId)
      const state = toolCallId ? this.tools.get(toolCallId) : null
      if (state) state.waitingForApproval = false
      return [chunk]
    }

    if (isToolTerminal(chunk) && "toolCallId" in chunk) {
      const state = this.tools.get(chunk.toolCallId)
      if (state?.phase === "terminal") return []
      if (state) {
        state.phase = "terminal"
        state.waitingForApproval = false
      }
      return [chunk]
    }

    if (chunk.type === "finish-step") {
      return [...this.closeDanglingTools(chunk.type, true), chunk]
    }

    if (isRunTerminal(chunk)) {
      const allowSuspension = chunk.type === "finish"
      const normalized = [...this.closeDanglingTools(chunk.type, allowSuspension), chunk]
      this.terminal = true
      return normalized
    }

    return [chunk]
  }

  private closeDanglingTools(
    terminal: "abort" | "error" | "finish" | "finish-step",
    allowSuspension: boolean,
  ) {
    const chunks: AiChatStreamChunk[] = []
    for (const [toolCallId, state] of this.tools) {
      if (state.phase === "terminal") continue
      if (allowSuspension && (state.waitingForApproval || CLIENT_SUSPENSION_TOOLS.has(state.name))) {
        continue
      }
      const failure = toolFailure(toolCallId, state.name, terminal, state.phase === "started")
      chunks.push(
        state.phase === "started"
          ? {
              type: "tool-input-error",
              toolCallId,
              toolName: state.name,
              input: state.input,
              errorText: failure.message,
              failure,
            }
          : {
              type: "tool-output-error",
              toolCallId,
              errorText: failure.message,
              failure,
            },
      )
      state.phase = "terminal"
      state.waitingForApproval = false
    }
    return chunks
  }
}
