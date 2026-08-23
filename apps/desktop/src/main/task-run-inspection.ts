/**
 * [INPUT]: SQLite task_run 与按序持久化的 AI Chat 事件、共享 RunPolicy/资源摘要守卫
 * [OUTPUT]: 不泄露提示词、正文、绝对路径或供应商秘密的单次运行解释
 * [POS]: task-run:read IPC 与数据库运行记录之间的只读投影边界
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type AiChatStreamEvent,
  type TaskRunErrorDataV1,
  type TaskRunInspection,
  isTaskRunPolicy,
  isTaskRunResourceSummary,
} from "@tessera/contracts"
import type { TaskRun, TaskRunEventRecord } from "@tessera/database"
import { parseAiChatStreamEvent } from "./ai-chat-event"

type PersistedTaskRun = TaskRun & { events: TaskRunEventRecord[] }

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function corruptEventFailure(): TaskRunErrorDataV1 {
  return {
    code: "runtime",
    message: "这次运行的部分本地日志无法读取。",
    phase: "stream",
    retryable: false,
    version: 1,
  }
}

export function inspectTaskRun(run: PersistedTaskRun): TaskRunInspection {
  const toolCalls = new Map<
    string,
    { counted: boolean; denialCount: number; failureCount: number; name: string }
  >()
  let failure: TaskRunErrorDataV1 | null = null

  const ensureTool = (toolCallId: string, name?: string) => {
    const current = toolCalls.get(toolCallId)
    if (current) {
      if (name && current.name === "unknown-tool") current.name = name
      return current
    }
    const created = {
      counted: false,
      denialCount: 0,
      failureCount: 0,
      name: name ?? "unknown-tool",
    }
    toolCalls.set(toolCallId, created)
    return created
  }

  for (const record of run.events) {
    let event: AiChatStreamEvent
    try {
      event = parseAiChatStreamEvent(record.payloadJson)
    } catch {
      failure ??= corruptEventFailure()
      continue
    }
    const chunk = event.chunk
    if (chunk.type === "error") {
      failure = chunk.failure ?? {
        code: "runtime",
        message: chunk.errorText,
        phase: "stream",
        retryable: false,
        version: 1,
      }
      continue
    }
    if (
      chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error"
    ) {
      const tool = ensureTool(chunk.toolCallId, chunk.toolName)
      tool.counted = true
      if (chunk.type === "tool-input-error") tool.failureCount += 1
      continue
    }
    if (chunk.type === "tool-output-error") {
      const tool = ensureTool(chunk.toolCallId, chunk.failure?.toolName)
      tool.counted = true
      tool.failureCount += 1
      continue
    }
    if (chunk.type === "tool-output-denied") {
      const tool = ensureTool(chunk.toolCallId)
      tool.counted = true
      tool.denialCount += 1
    }
  }

  const toolsByName = new Map<string, TaskRunInspection["tools"][number]>()
  for (const tool of toolCalls.values()) {
    if (!tool.counted) continue
    const current = toolsByName.get(tool.name)
    if (current) {
      current.callCount += 1
      current.failureCount += tool.failureCount
      current.denialCount += tool.denialCount
    } else {
      toolsByName.set(tool.name, {
        name: tool.name,
        callCount: 1,
        failureCount: tool.failureCount,
        denialCount: tool.denialCount,
      })
    }
  }

  const policyValue = parseJson(run.policyJson)
  const resourceValue = parseJson(run.resourceSummaryJson)
  return {
    requestId: run.requestId,
    taskId: run.taskId,
    status: run.status,
    model: {
      configId: run.configId,
      providerId: run.providerId,
      modelId: run.modelId,
    },
    policy: isTaskRunPolicy(policyValue) ? policyValue : null,
    resources: isTaskRunResourceSummary(resourceValue) ? resourceValue : null,
    tools: [...toolsByName.values()],
    failure,
    finishReason: run.finishReason,
    usage: {
      inputTokens: run.inputTokens,
      cacheReadTokens: run.cacheReadTokens,
      cacheWriteTokens: run.cacheWriteTokens,
      outputTokens: run.outputTokens,
      reasoningTokens: run.reasoningTokens,
      totalTokens: run.totalTokens,
    },
    timing: {
      timeToFirstOutputMs: run.timeToFirstOutputMs,
      modelDurationMs: run.modelDurationMs,
      toolDurationMs: run.toolDurationMs,
      durationMs: run.durationMs,
    },
    startedAt: run.startedAt.getTime(),
    completedAt: run.completedAt?.getTime() ?? null,
  }
}
