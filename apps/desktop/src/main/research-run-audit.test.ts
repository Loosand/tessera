/**
 * [INPUT]: 内存 SQLite 中完整或故意不一致的研究运行、领域状态与有序事件
 * [OUTPUT]: 黄金运行审计通过和数据库/最终报告缺口识别的回归验证
 * [POS]: 真实供应商研究校准之前的确定性审计单元测试
 * [DOC]: docs/architecture/research-workflow.md、docs/quality/research-fkj-golden-run.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  appendTaskRunEvent,
  finishResearchRun,
  finishTaskRun,
  openDatabase,
  publishResearchPlan,
  resumeResearchRun,
  saveResearchEvidence,
  saveResearchRecommendations,
  saveResearchSource,
  saveTaskSession,
  startResearchRun,
  startTaskRun,
  updateTaskSessionStatus,
} from "@tessera/database"
import { describe, expect, it } from "vitest"
import { auditResearchRun } from "./research-run-audit"

function goldenResearchFixture(options: { inheritPlan?: boolean } = {}) {
  const client = openDatabase({ path: ":memory:" })
  const now = new Date(100)
  saveTaskSession(client, {
    id: "task-fkj",
    mode: "chat",
    workspaceId: null,
    title: "了解 FKJ",
    status: "running",
    updatedAt: now,
    messagePayloads: [],
  })
  if (options.inheritPlan) {
    startTaskRun(client, {
      requestId: "run-fkj-plan",
      taskId: "task-fkj",
      configId: "provider",
      providerId: "openai-compatible",
      modelId: "research-model",
      mode: "chat",
      skillId: "research",
      reasoning: "high",
      webSearch: true,
      policyJson: "{}",
      resourceSummaryJson: "{}",
      startedAt: now,
    })
    appendTaskRunEvent(client, {
      requestId: "run-fkj-plan",
      sequence: 1,
      payloadJson: JSON.stringify({
        requestId: "run-fkj-plan",
        sequence: 1,
        taskId: "task-fkj",
        chunk: {
          type: "tool-input-available",
          toolCallId: "plan-call",
          toolName: "publish-research-plan",
          input: {},
        },
      }),
    })
    appendTaskRunEvent(client, {
      requestId: "run-fkj-plan",
      sequence: 2,
      payloadJson: JSON.stringify({
        requestId: "run-fkj-plan",
        sequence: 2,
        taskId: "task-fkj",
        chunk: {
          type: "tool-output-available",
          toolCallId: "plan-call",
          output: { status: "published", questionIds: ["q1", "q2"] },
        },
      }),
    })
    finishTaskRun(client, "run-fkj-plan", "failed", { toolCallCount: 1, stepCount: 1 })
  }
  startTaskRun(client, {
    requestId: "run-fkj",
    taskId: "task-fkj",
    configId: "provider",
    providerId: "openai-compatible",
    modelId: "research-model",
    mode: "chat",
    skillId: "research",
    reasoning: "high",
    webSearch: true,
    policyJson: "{}",
    resourceSummaryJson: JSON.stringify({
      attachmentCount: 0,
      currentDocumentPath: null,
      researchNetworkMode: "system",
      resumedResearchRequestId: options.inheritPlan ? "run-fkj-plan" : null,
      workspaceId: null,
      workspaceName: null,
    }),
    startedAt: now,
  })
  startResearchRun(client, { requestId: "run-fkj", taskId: "task-fkj", startedAt: now })
  publishResearchPlan(client, {
    requestId: "run-fkj",
    objective: "了解 FKJ 的经历与现场创作",
    scope: "公开资料",
    deliverable: "带来源的人物导览",
    questions: [
      { id: "q1", title: "成长经历是什么？" },
      { id: "q2", title: "现场创作有什么特点？" },
    ],
  })
  for (const [index, url] of ["https://example.com/one", "https://example.org/two"].entries()) {
    saveResearchSource(client, {
      id: `source-${index + 1}`,
      requestId: "run-fkj",
      url,
      canonicalUrl: url,
      finalUrl: url,
      title: `FKJ interview ${index + 1}`,
      author: null,
      publishedAt: null,
      discoveredByQuery: "FKJ interview",
      questionIds: [index === 0 ? "q1" : "q2"],
      status: "read",
      contentType: "text/html",
      contentHash: `sha256:${index + 1}`,
      charCount: 2000,
      truncated: false,
      errorMessage: null,
    })
  }
  for (const [index, questionId] of ["q1", "q1", "q2", "q2"].entries()) {
    saveResearchEvidence(client, {
      id: `evidence-${index + 1}`,
      requestId: "run-fkj",
      sourceId: index < 2 ? "source-1" : "source-2",
      questionId,
      relation: "supports",
      claim: `核验声明 ${index + 1}`,
      excerpt: `Verbatim evidence ${index + 1}`,
      locator: `p${index + 1}`,
    })
  }
  saveResearchRecommendations(client, [
    {
      id: "recommendation-1",
      requestId: "run-fkj",
      sourceId: "source-1",
      reason: "一手访谈。",
    },
  ])
  finishResearchRun(client, {
    requestId: "run-fkj",
    outcome: "complete",
    limitations: [],
    questions: [
      { id: "q1", status: "covered", note: "已核验" },
      { id: "q2", status: "covered", note: "已核验" },
    ],
  })

  let sequence = 0
  const append = (chunk: Record<string, unknown>) => {
    sequence += 1
    appendTaskRunEvent(client, {
      requestId: "run-fkj",
      sequence,
      payloadJson: JSON.stringify({ requestId: "run-fkj", sequence, chunk, taskId: "task-fkj" }),
    })
  }
  let call = 0
  const tool = (toolName: string, output: unknown) => {
    call += 1
    const toolCallId = `call-${call}`
    append({ type: "tool-input-available", toolCallId, toolName, input: {} })
    append({ type: "tool-output-available", toolCallId, output })
  }
  if (!options.inheritPlan) {
    tool("publish-research-plan", { status: "published", questionIds: ["q1", "q2"] })
  }
  tool("web_search", [{ url: "https://example.com/one" }])
  tool("web_search", [{ url: "https://example.org/two" }])
  tool("read-web-source", { status: "read", sourceId: "source-1", requestId: "run-fkj" })
  tool("read-web-source", { status: "read", sourceId: "source-2", requestId: "run-fkj" })
  for (let index = 1; index <= 4; index += 1) {
    tool("record-research-evidence", {
      status: "recorded",
      evidenceId: `evidence-${index}`,
      requestId: "run-fkj",
    })
  }
  tool("recommend-research-sources", {
    status: "recommended",
    requestId: "run-fkj",
    recommendations: [{ sourceId: "source-1" }],
  })
  tool("finalize-research", {
    status: "completed",
    requestId: "run-fkj",
    progress: { phase: "completed", outcome: "complete" },
  })
  append({ type: "text-delta", id: "answer", delta: "x".repeat(450) })
  append({ type: "finish", finishReason: "stop" })
  finishTaskRun(client, "run-fkj", "completed", { toolCallCount: call, stepCount: 8 })
  updateTaskSessionStatus(client, "task-fkj", "completed")
  return client
}

describe("研究黄金运行审计", () => {
  it("同时核对计划、搜索、深读、证据、推荐、完成报告与持久化计数", () => {
    const client = goldenResearchFixture()
    const report = auditResearchRun(client, "run-fkj")
    expect(report.passed).toBe(true)
    expect(report.metrics).toMatchObject({
      searchCallCount: 2,
      readSourceCount: 2,
      evidenceCount: 4,
      recommendationCount: 1,
      finalTextCharacters: 450,
    })
    client.close()
  })

  it("会把状态漂移与缺少最终报告作为失败而非研究成功", () => {
    const client = goldenResearchFixture()
    updateTaskSessionStatus(client, "task-fkj", "running")
    const report = auditResearchRun(client, "run-fkj", {
      minimumEvidence: 4,
      minimumFinalTextCharacters: 800,
      minimumReadSources: 2,
      minimumRecommendations: 1,
      minimumSearchCalls: 2,
    })
    expect(report.passed).toBe(false)
    expect(report.checks.filter((item) => !item.passed).map((item) => item.id)).toEqual([
      "task-status",
      "final-report",
    ])
    client.close()
  })

  it("把带显式 provenance 的续跑计划纳入同一条黄金审计链", () => {
    const client = goldenResearchFixture({ inheritPlan: true })
    const report = auditResearchRun(client, "run-fkj")
    expect(report.checks.filter((item) => !item.passed)).toEqual([])
    expect(report.resumedFromRequestIds).toEqual(["run-fkj-plan"])
    expect(report.checks.find((item) => item.id === "plan-first")?.detail).toContain("继承已发布计划")
    client.close()
  })

  it("已完成研究的纯文本续跑继承祖先完成检查，但必须交付本轮正文", () => {
    const client = goldenResearchFixture()
    const now = new Date(200)
    startTaskRun(client, {
      requestId: "run-fkj-continuation",
      taskId: "task-fkj",
      configId: "provider",
      providerId: "openai-compatible",
      modelId: "research-model",
      mode: "chat",
      skillId: "research",
      reasoning: "high",
      webSearch: true,
      policyJson: "{}",
      resourceSummaryJson: JSON.stringify({
        attachmentCount: 0,
        currentDocumentPath: null,
        researchNetworkMode: "system",
        resumedResearchRequestId: "run-fkj",
        workspaceId: null,
        workspaceName: null,
      }),
      startedAt: now,
    })
    startResearchRun(client, {
      requestId: "run-fkj-continuation",
      taskId: "task-fkj",
      startedAt: now,
    })
    resumeResearchRun(client, {
      fromRequestId: "run-fkj",
      taskId: "task-fkj",
      toRequestId: "run-fkj-continuation",
    })
    appendTaskRunEvent(client, {
      requestId: "run-fkj-continuation",
      sequence: 1,
      payloadJson: JSON.stringify({
        requestId: "run-fkj-continuation",
        sequence: 1,
        taskId: "task-fkj",
        chunk: { type: "text-delta", id: "answer", delta: "x".repeat(450) },
      }),
    })
    appendTaskRunEvent(client, {
      requestId: "run-fkj-continuation",
      sequence: 2,
      payloadJson: JSON.stringify({
        requestId: "run-fkj-continuation",
        sequence: 2,
        taskId: "task-fkj",
        chunk: { type: "finish", finishReason: "stop" },
      }),
    })
    finishTaskRun(client, "run-fkj-continuation", "completed", {
      toolCallCount: 0,
      stepCount: 1,
    })
    updateTaskSessionStatus(client, "task-fkj", "completed")

    const report = auditResearchRun(client, "run-fkj-continuation")
    expect(report.passed).toBe(true)
    expect(report.resumedFromRequestIds).toEqual(["run-fkj"])
    expect(report.metrics.finalTextCharacters).toBe(450)
    expect(report.checks.find((item) => item.id === "finalization")?.detail).toContain("继承祖先完成检查")
    client.close()
  })
})
