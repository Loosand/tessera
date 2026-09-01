/**
 * [INPUT]: 持久化 task_run、带压缩 marker 的 ContextManifest、文件/Web/MCP/审批/turn/tool/terminal 事件、类型化运行/工具错误与损坏事件
 * [OUTPUT]: 单次运行的 Progress、实际 Execution Context、策略/资源/上下文预算、生命周期、Token/执行指标、失败与安全降级回归测试
 * [POS]: task-run-inspection 的主进程单元测试
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/agent-product-feedback-layer.md、docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
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
      contextManifest: {
        availableInputTokens: 100_000,
        estimatedInputTokens: 12_000,
        estimator: "heuristic-v1",
        modelContextWindow: 128_000,
        modelMaxInputTokens: null,
        observedStep: 2,
        reservedOutputTokens: 16_000,
        safetyMarginTokens: 6_000,
        sections: [{ kind: "conversation", estimatedTokens: 12_000 }],
        status: "within-budget",
        version: 1,
      },
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
        event(1, { type: "start-step" }),
        event(2, { type: "tool-input-start", toolCallId: "search-1", toolName: "web_search" }),
        event(3, {
          type: "tool-input-available",
          toolCallId: "search-1",
          toolName: "web_search",
          input: { query: "Celeste" },
        }),
        event(4, { type: "tool-output-available", toolCallId: "search-1", output: [] }),
        event(5, { type: "tool-input-start", toolCallId: "search-2", toolName: "web_search" }),
        event(6, { type: "tool-output-denied", toolCallId: "search-2" }),
        event(7, {
          type: "tool-input-error",
          toolCallId: "read-1",
          toolName: "read-web-source",
          input: { url: "https://example.com" },
          errorText: "读取失败",
        }),
        event(8, { type: "finish-step" }),
        event(9, { type: "finish", finishReason: "stop" }),
      ]),
    )

    expect(inspection.model).toEqual({
      configId: "deepseek-main",
      providerId: "deepseek",
      modelId: "deepseek-v4",
    })
    expect(inspection.policy).toEqual(policy)
    expect(inspection.resources).toMatchObject({
      contextManifest: { estimatedInputTokens: 12_000, status: "within-budget" },
      currentDocumentPath: "draft.md",
      researchNetworkMode: "system",
      workspaceName: "专题",
    })
    expect(inspection.tools).toEqual([
      { name: "web_search", callCount: 2, failureCount: 0, denialCount: 1 },
      { name: "read-web-source", callCount: 1, failureCount: 1, denialCount: 0 },
    ])
    expect(inspection.execution).toEqual({ stepCount: 3, toolCallCount: 2 })
    expect(inspection.lifecycle).toEqual({ awaitingToolCount: 0, terminal: "finish", turnCount: 1 })
    expect(inspection.failure).toBeNull()
    expect(inspection.usage).toEqual({
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      inputTokens: 100,
      outputTokens: 80,
      reasoningTokens: 20,
      totalTokens: 180,
    })
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

  it("只从成功工具与来源事件投影安全文件、Web hostname 和 MCP 上下文", () => {
    const inspection = inspectTaskRun(
      run([
        event(1, { type: "start-step" }),
        event(2, {
          type: "tool-input-available",
          toolCallId: "read-file",
          toolName: "read",
          input: { path: "notes/topic.md" },
        }),
        event(3, { type: "tool-output-available", toolCallId: "read-file", output: { content: "" } }),
        event(4, {
          type: "tool-input-available",
          toolCallId: "bash-write",
          toolName: "bash",
          input: { command: "printf output" },
        }),
        event(5, {
          type: "tool-output-available",
          toolCallId: "bash-write",
          output: {
            changedFiles: ["artifact.md", ".env", "private/.token", "../outside.md", "/absolute.md"],
          },
        }),
        event(6, {
          type: "tool-input-available",
          toolCallId: "read-web",
          toolName: "read-web-source",
          input: { url: "https://Example.com/article?token=hidden#section" },
        }),
        event(7, { type: "tool-output-available", toolCallId: "read-web", output: { status: "read" } }),
        event(8, {
          type: "source-url",
          sourceId: "source-1",
          url: "https://docs.example.org/reference?q=private",
        }),
        event(9, {
          type: "tool-input-available",
          toolCallId: "mcp-call",
          toolName: "mcp__0123456789__lookup__abcdef",
          input: { secret: "不得进入投影" },
        }),
        event(10, { type: "tool-output-available", toolCallId: "mcp-call", output: { value: "隐藏" } }),
        event(11, { type: "finish-step" }),
        event(12, { type: "finish", finishReason: "stop" }),
      ]),
    )

    expect(inspection.executionContext).toEqual({
      files: ["notes/topic.md", "artifact.md"],
      mcpTools: ["mcp__0123456789__lookup__abcdef"],
      truncated: false,
      webHosts: ["example.com", "docs.example.org"],
    })
    expect(inspection.progress).toEqual({
      completedActionCount: 4,
      currentToolName: null,
      phase: "completed",
      totalActionCount: 4,
    })
    expect(JSON.stringify(inspection)).not.toContain("token=hidden")
    expect(JSON.stringify(inspection)).not.toContain("不得进入投影")
  })

  it("按稳定上限截断执行上下文而不返回完整来源 URL", () => {
    const inspection = inspectTaskRun(
      run([
        ...Array.from({ length: 17 }, (_, index) =>
          event(index + 1, {
            type: "source-url",
            sourceId: `source-${index}`,
            url: `https://host-${index}.example/private?token=${index}`,
          }),
        ),
        event(18, { type: "finish", finishReason: "stop" }),
      ]),
    )

    expect(inspection.executionContext.webHosts).toHaveLength(16)
    expect(inspection.executionContext.webHosts.at(-1)).toBe("host-15.example")
    expect(inspection.executionContext.truncated).toBe(true)
    expect(JSON.stringify(inspection)).not.toContain("/private")
    expect(JSON.stringify(inspection)).not.toContain("token=")
  })

  it("把结构化提问或待审批工具投影为可恢复等待进度", () => {
    const waiting = run([
      event(1, { type: "start-step" }),
      event(2, {
        type: "tool-input-available",
        toolCallId: "question-1",
        toolName: "request-user-input",
        input: { question: "不进入投影" },
      }),
      event(3, { type: "finish-step" }),
      event(4, { type: "finish", finishReason: "tool-calls" }),
    ])

    expect(inspectTaskRun(waiting).progress).toEqual({
      completedActionCount: 0,
      currentToolName: "request-user-input",
      phase: "waiting",
      totalActionCount: 1,
    })
  })
})
