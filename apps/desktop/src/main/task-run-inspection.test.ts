/**
 * [INPUT]: 持久化 task_run、重复工具生命周期事件、类型化运行/工具错误与损坏事件
 * [OUTPUT]: 单次运行解释的策略/资源解析、工具归因、失败与安全降级回归测试
 * [POS]: task-run-inspection 的主进程单元测试
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamChunk, AiChatStreamEvent, TaskRunPolicy } from "@tessera/contracts"
import type { TaskRun, TaskRunEventRecord } from "@tessera/database"
import { describe, expect, it } from "vitest"
import { inspectTaskRun } from "./task-run-inspection"

const policy = {
  limits: { maxOutputTokens: null, maxSteps: 12, timeoutMs: 120_000 },
  mode: "agent",
  reasoning: "high",
  skillId: "research",
  toolScope: "workspace-write",
  webSearch: true,
} satisfies TaskRunPolicy

function event(sequence: number, chunk: AiChatStreamChunk): TaskRunEventRecord {
  const payload = {
    requestId: "run-1",
    taskId: "task-1",
    sequence,
    chunk,
  } satisfies AiChatStreamEvent
  return {
    id: `run-1:${sequence}`,
    requestId: "run-1",
    sequence,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date(sequence),
  }
}

function run(events: TaskRunEventRecord[]): TaskRun & { events: TaskRunEventRecord[] } {
  return {
    requestId: "run-1",
    taskId: "task-1",
    configId: "deepseek-main",
    providerId: "deepseek",
    modelId: "deepseek-v4",
    mode: "agent",
    skillId: "research",
    reasoning: "high",
    webSearch: true,
    policyJson: JSON.stringify(policy),
    resourceSummaryJson: JSON.stringify({
      attachmentCount: 1,
      currentDocumentPath: "draft.md",
      researchNetworkMode: "system",
      workspaceId: "workspace-1",
      workspaceName: "专题",
    }),
    sdkCallId: "sdk-call-1",
    finishReason: "stop",
    rawFinishReason: "stop",
    inputTokens: 100,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
    outputTokens: 80,
    reasoningTokens: 20,
    totalTokens: 180,
    stepCount: 3,
    toolCallCount: 2,
    timeToFirstOutputMs: 120,
    modelDurationMs: 900,
    toolDurationMs: 400,
    durationMs: 1_500,
    status: "completed",
    lastSequence: events.at(-1)?.sequence ?? 0,
    startedAt: new Date(1_000),
    updatedAt: new Date(2_500),
    completedAt: new Date(2_500),
    events,
  }
}

describe("inspectTaskRun", () => {
  it("解释实际模型、Skill、资源，并按 toolCallId 去重后聚合工具结果", () => {
    const inspection = inspectTaskRun(
      run([
        event(1, { type: "tool-input-start", toolCallId: "search-1", toolName: "web_search" }),
        event(2, {
          type: "tool-input-available",
          toolCallId: "search-1",
          toolName: "web_search",
          input: { query: "Celeste" },
        }),
        event(3, { type: "tool-output-available", toolCallId: "search-1", output: [] }),
        event(4, { type: "tool-input-start", toolCallId: "search-2", toolName: "web_search" }),
        event(5, { type: "tool-output-denied", toolCallId: "search-2" }),
        event(6, {
          type: "tool-input-error",
          toolCallId: "read-1",
          toolName: "read-web-source",
          input: { url: "https://example.com" },
          errorText: "读取失败",
        }),
        event(7, { type: "finish", finishReason: "stop" }),
      ]),
    )

    expect(inspection.model).toEqual({
      configId: "deepseek-main",
      providerId: "deepseek",
      modelId: "deepseek-v4",
    })
    expect(inspection.policy).toEqual(policy)
    expect(inspection.resources).toMatchObject({
      currentDocumentPath: "draft.md",
      researchNetworkMode: "system",
      workspaceName: "专题",
    })
    expect(inspection.tools).toEqual([
      { name: "web_search", callCount: 2, failureCount: 0, denialCount: 1 },
      { name: "read-web-source", callCount: 1, failureCount: 1, denialCount: 0 },
    ])
    expect(inspection.failure).toBeNull()
    expect(inspection.usage.totalTokens).toBe(180)
  })

  it("保留类型化运行失败，并把损坏事件降级为可展示失败", () => {
    const typedFailure = {
      code: "provider-timeout",
      message: "模型响应超时。",
      phase: "stream",
      retryable: true,
      version: 1,
    } as const
    const failed = inspectTaskRun(
      run([event(1, { type: "error", errorText: typedFailure.message, failure: typedFailure })]),
    )
    expect(failed.failure).toEqual(typedFailure)

    const corruptRecord = event(1, { type: "start" })
    corruptRecord.payloadJson = "{broken"
    const corrupt = inspectTaskRun(run([corruptRecord]))
    expect(corrupt.failure).toMatchObject({ code: "runtime", retryable: false })
  })
})
