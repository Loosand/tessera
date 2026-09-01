/**
 * [INPUT]: SQLite task_run 与按序持久化的 AI Chat 事件、共享 RunPolicy/资源摘要守卫
 * [OUTPUT]: 不泄露提示词、正文、命令、绝对路径或供应商秘密的 Progress、实际 Execution Context、turn/tool 生命周期、压缩与 Token 用量审计
 * [POS]: task-run:read IPC 与数据库运行记录之间的只读投影边界
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/agent-product-feedback-layer.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
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

const MAX_CONTEXT_FILES = 32
const MAX_CONTEXT_WEB_HOSTS = 16
const MAX_CONTEXT_MCP_TOOLS = 16
const FILE_TOOL_NAMES = new Set([
  "read",
  "edit",
  "write",
  "read-workspace-file",
  "read-current-document",
  "write-workspace-document",
])

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

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeWorkspaceRelativePath(value: unknown) {
  if (typeof value !== "string") return null
  const path = value.trim().replaceAll("\\", "/")
  if (
    !path ||
    path.length > 1_024 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-z]:\//iu.test(path) ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
  ) {
    return null
  }
  return path
}

function safeWebHost(value: unknown) {
  if (typeof value !== "string" || value.length > 4_096) return null
  try {
    const url = new URL(value)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

function progressPhase(
  status: TaskRunInspection["status"],
  waitingForUser: boolean,
): TaskRunInspection["progress"]["phase"] {
  if (waitingForUser) return "waiting"
  if (status === "running") return "working"
  if (status === "completed") return "completed"
  if (status === "cancelled") return "cancelled"
  if (status === "interrupted") return "interrupted"
  return "failed"
}

export function inspectTaskRun(run: PersistedTaskRun): TaskRunInspection {
  const toolCalls = new Map<
    string,
    {
      acceptedSequence: number | null
      counted: boolean
      denialCount: number
      failureCount: number
      input: unknown
      name: string
    }
  >()
  const acceptedToolCalls = new Set<string>()
  const terminalToolCalls = new Set<string>()
  const pendingApprovalToolCalls = new Set<string>()
  const approvalToolCalls = new Map<string, string>()
  const contextFiles = new Set<string>()
  const contextWebHosts = new Set<string>()
  const contextMcpTools = new Set<string>()
  let executionContextTruncated = false
  let terminal: TaskRunInspection["lifecycle"]["terminal"] = null
  let turnCount = 0
  let failure: TaskRunErrorDataV1 | null = null

  const ensureTool = (toolCallId: string, name?: string) => {
    const current = toolCalls.get(toolCallId)
    if (current) {
      if (name && current.name === "unknown-tool") current.name = name
      return current
    }
    const created = {
      acceptedSequence: null,
      counted: false,
      denialCount: 0,
      failureCount: 0,
      input: undefined,
      name: name ?? "unknown-tool",
    }
    toolCalls.set(toolCallId, created)
    return created
  }

  const addContextValue = (values: Set<string>, value: string | null, limit: number) => {
    if (!value || values.has(value)) return
    if (values.size >= limit) {
      executionContextTruncated = true
      return
    }
    values.add(value)
  }

  const recordSuccessfulToolContext = (toolCallId: string, output: unknown) => {
    const tool = toolCalls.get(toolCallId)
    if (!tool) return
    const input = objectValue(tool.input)
    if (FILE_TOOL_NAMES.has(tool.name)) {
      addContextValue(contextFiles, safeWorkspaceRelativePath(input?.path), MAX_CONTEXT_FILES)
    }
    if (tool.name === "bash") {
      const changedFiles = objectValue(output)?.changedFiles
      if (Array.isArray(changedFiles)) {
        for (const path of changedFiles) {
          addContextValue(contextFiles, safeWorkspaceRelativePath(path), MAX_CONTEXT_FILES)
        }
      }
    }
    if (tool.name === "read-web-source") {
      addContextValue(contextWebHosts, safeWebHost(input?.url), MAX_CONTEXT_WEB_HOSTS)
    }
    if (tool.name.startsWith("mcp__")) {
      addContextValue(contextMcpTools, tool.name, MAX_CONTEXT_MCP_TOOLS)
    }
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
    if (chunk.type === "start-step") turnCount += 1
    if (chunk.type === "source-url") {
      addContextValue(contextWebHosts, safeWebHost(chunk.url), MAX_CONTEXT_WEB_HOSTS)
      continue
    }
    if (chunk.type === "finish" || chunk.type === "abort" || chunk.type === "error") {
      terminal = chunk.type
    }
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
      if (chunk.type === "tool-input-available") {
        acceptedToolCalls.add(chunk.toolCallId)
        tool.acceptedSequence = record.sequence
        tool.input = chunk.input
      }
      if (chunk.type === "tool-input-error") {
        terminalToolCalls.add(chunk.toolCallId)
        tool.failureCount += 1
      }
      continue
    }
    if (chunk.type === "tool-approval-request") {
      approvalToolCalls.set(chunk.approvalId, chunk.toolCallId)
      pendingApprovalToolCalls.add(chunk.toolCallId)
      continue
    }
    if (chunk.type === "tool-approval-response") {
      const toolCallId = approvalToolCalls.get(chunk.approvalId)
      if (toolCallId) pendingApprovalToolCalls.delete(toolCallId)
      continue
    }
    if (chunk.type === "tool-output-error") {
      terminalToolCalls.add(chunk.toolCallId)
      pendingApprovalToolCalls.delete(chunk.toolCallId)
      const tool = ensureTool(chunk.toolCallId, chunk.failure?.toolName)
      tool.counted = true
      tool.failureCount += 1
      continue
    }
    if (chunk.type === "tool-output-denied") {
      terminalToolCalls.add(chunk.toolCallId)
      pendingApprovalToolCalls.delete(chunk.toolCallId)
      const tool = ensureTool(chunk.toolCallId)
      tool.counted = true
      tool.denialCount += 1
      continue
    }
    if (chunk.type === "tool-output-available" && chunk.preliminary !== true) {
      terminalToolCalls.add(chunk.toolCallId)
      pendingApprovalToolCalls.delete(chunk.toolCallId)
      recordSuccessfulToolContext(chunk.toolCallId, chunk.output)
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
  const awaitingTools = [...acceptedToolCalls]
    .filter((toolCallId) => !terminalToolCalls.has(toolCallId))
    .map((toolCallId) => ({ toolCallId, tool: toolCalls.get(toolCallId) }))
    .filter(
      (
        entry,
      ): entry is {
        toolCallId: string
        tool: NonNullable<ReturnType<typeof toolCalls.get>>
      } => Boolean(entry.tool),
    )
    .sort((left, right) => (left.tool.acceptedSequence ?? 0) - (right.tool.acceptedSequence ?? 0))
  const currentTool = awaitingTools.at(-1) ?? null
  const waitingForUser = Boolean(
    currentTool &&
      (currentTool.tool.name === "request-user-input" ||
        pendingApprovalToolCalls.has(currentTool.toolCallId)),
  )
  return {
    requestId: run.requestId,
    taskId: run.taskId,
    status: run.status,
    executionContext: {
      files: [...contextFiles],
      mcpTools: [...contextMcpTools],
      truncated: executionContextTruncated,
      webHosts: [...contextWebHosts],
    },
    execution: {
      stepCount: run.stepCount,
      toolCallCount: run.toolCallCount,
    },
    model: {
      configId: run.configId,
      providerId: run.providerId,
      modelId: run.modelId,
    },
    policy: isTaskRunPolicy(policyValue) ? policyValue : null,
    progress: {
      completedActionCount: terminalToolCalls.size,
      currentToolName: currentTool?.tool.name ?? null,
      phase: progressPhase(run.status, waitingForUser),
      totalActionCount: [...toolCalls.values()].filter((tool) => tool.counted).length,
    },
    resources: isTaskRunResourceSummary(resourceValue) ? resourceValue : null,
    tools: [...toolsByName.values()],
    failure,
    finishReason: run.finishReason,
    lifecycle: {
      awaitingToolCount: [...acceptedToolCalls].filter((toolCallId) => !terminalToolCalls.has(toolCallId))
        .length,
      terminal,
      turnCount,
    },
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
