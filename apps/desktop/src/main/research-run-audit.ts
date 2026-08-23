/**
 * [INPUT]: 已持久化的 task_run 有序事件、任务会话状态与研究计划/来源/证据/推荐/完成快照
 * [OUTPUT]: 可重复执行的研究黄金运行检查、工具计数与跨表一致性报告
 * [POS]: 真实供应商端到端校准的只读审计边界，不参与研究执行或修改用户内容
 * [DOC]: docs/architecture/research-workflow.md、docs/quality/research-fkj-golden-run.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { isTaskRunResourceSummary } from "@tessera/contracts"
import { type DatabaseClient, findResearchRun, findTaskRun, findTaskSession } from "@tessera/database"

export type ResearchRunAuditCheck = Readonly<{
  detail: string
  id:
    | "event-sequence"
    | "task-status"
    | "research-policy"
    | "plan-first"
    | "multi-round-search"
    | "deep-reading"
    | "unusable-sources"
    | "evidence-ledger"
    | "source-curation"
    | "finalization"
    | "final-report"
    | "database-consistency"
  passed: boolean
}>

export type ResearchRunAuditCriteria = Readonly<{
  minimumEvidence: number
  minimumFinalTextCharacters: number
  minimumReadSources: number
  minimumRecommendations: number
  minimumSearchCalls: number
}>

export const FKJ_GOLDEN_RUN_CRITERIA = {
  minimumEvidence: 4,
  minimumFinalTextCharacters: 400,
  minimumReadSources: 2,
  minimumRecommendations: 1,
  minimumSearchCalls: 2,
} as const satisfies ResearchRunAuditCriteria

type ToolCall = Readonly<{
  inputSequence: number
  output: Record<string, unknown> | null
  outputSequence: number | null
  outputType: string | null
  toolCallId: string
  toolName: string
}>

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parsedChunk(payloadJson: string) {
  try {
    const event = object(JSON.parse(payloadJson))
    return object(event?.chunk)
  } catch {
    return null
  }
}

function toolCalls(events: readonly Readonly<{ payloadJson: string; sequence: number }>[]): ToolCall[] {
  const calls = new Map<
    string,
    {
      inputSequence: number
      output: Record<string, unknown> | null
      outputSequence: number | null
      outputType: string | null
      toolCallId: string
      toolName: string
    }
  >()
  for (const event of events) {
    const chunk = parsedChunk(event.payloadJson)
    if (!chunk || typeof chunk.type !== "string" || typeof chunk.toolCallId !== "string") continue
    if (chunk.type === "tool-input-available" && typeof chunk.toolName === "string") {
      calls.set(chunk.toolCallId, {
        inputSequence: event.sequence,
        output: null,
        outputSequence: null,
        outputType: null,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
      })
      continue
    }
    if (!chunk.type.startsWith("tool-output-")) continue
    const call = calls.get(chunk.toolCallId)
    if (!call) continue
    call.output = object(chunk.output)
    call.outputSequence = event.sequence
    call.outputType = chunk.type
  }
  return [...calls.values()].sort((left, right) => left.inputSequence - right.inputSequence)
}

function finalTextCharacters(
  events: readonly Readonly<{ payloadJson: string; sequence: number }>[],
  afterSequence: number,
) {
  let count = 0
  for (const event of events) {
    if (event.sequence <= afterSequence) continue
    const chunk = parsedChunk(event.payloadJson)
    if (chunk?.type === "text-delta" && typeof chunk.delta === "string") {
      count += chunk.delta.trim().length
    }
  }
  return count
}

function check(id: ResearchRunAuditCheck["id"], passed: boolean, detail: string) {
  return { id, passed, detail } as const
}

function resumedResearchRequestId(resourceSummaryJson: string | null) {
  if (!resourceSummaryJson) return null
  try {
    const summary = JSON.parse(resourceSummaryJson)
    return isTaskRunResourceSummary(summary) ? (summary.resumedResearchRequestId ?? null) : null
  } catch {
    return null
  }
}

function researchRunLineage(client: DatabaseClient, requestId: string) {
  const lineage = []
  const visited = new Set<string>()
  let currentRequestId: string | null = requestId
  while (currentRequestId && !visited.has(currentRequestId) && lineage.length < 16) {
    visited.add(currentRequestId)
    const run = findTaskRun(client, currentRequestId)
    if (!run) break
    lineage.unshift(run)
    currentRequestId = resumedResearchRequestId(run.resourceSummaryJson)
  }
  return lineage
}

export function auditResearchRun(
  client: DatabaseClient,
  requestId: string,
  criteria: ResearchRunAuditCriteria = FKJ_GOLDEN_RUN_CRITERIA,
) {
  const taskRun = findTaskRun(client, requestId)
  const researchRun = findResearchRun(client, requestId)
  if (!taskRun || !researchRun) throw new Error("找不到完整的研究运行记录。")
  const task = findTaskSession(client, taskRun.taskId)
  if (!task) throw new Error("研究运行对应的任务会话不存在。")

  const lineage = researchRunLineage(client, requestId)
  const calls = toolCalls(taskRun.events)
  const inheritedRuns = lineage.slice(0, -1)
  const inheritedCalls = inheritedRuns.flatMap((run) => toolCalls(run.events))
  const lineageCalls = [...inheritedCalls, ...calls]
  const successfulLineageOutputs = (name: string) =>
    lineageCalls.filter(
      (call) => call.toolName === name && call.outputType === "tool-output-available" && call.output,
    )
  const currentPlan = calls.find((call) => call.toolName === "publish-research-plan")
  const inheritedPlan = inheritedCalls.find((call) => call.toolName === "publish-research-plan")
  const plan = currentPlan ?? inheritedPlan
  const firstDiscovery = calls.find(
    (call) =>
      call.toolName.includes("web_search") ||
      call.toolName.includes("web-search") ||
      call.toolName === "read-web-source",
  )
  const currentFinalizations = calls.filter(
    (call) =>
      call.toolName === "finalize-research" && call.outputType === "tool-output-available" && call.output,
  )
  const completedCurrentFinalization = [...currentFinalizations]
    .reverse()
    .find((call) => call.output?.status === "completed" || call.output?.status === "partial")
  const completedInheritedFinalization = [...inheritedCalls]
    .reverse()
    .find(
      (call) =>
        call.toolName === "finalize-research" &&
        call.outputType === "tool-output-available" &&
        call.output &&
        (call.output.status === "completed" || call.output.status === "partial"),
    )
  const completedFinalization = completedCurrentFinalization ?? completedInheritedFinalization
  const textCharacters = finalTextCharacters(
    taskRun.events,
    completedCurrentFinalization?.outputSequence ?? 0,
  )
  const outputRead = successfulLineageOutputs("read-web-source").filter(
    (call) => call.output?.status === "read",
  ).length
  const outputUnusable = successfulLineageOutputs("read-web-source").filter(
    (call) => call.output?.status === "unusable",
  ).length
  const outputEvidence = successfulLineageOutputs("record-research-evidence").filter(
    (call) => call.output?.status === "recorded",
  ).length
  const outputRecommendations = successfulLineageOutputs("recommend-research-sources").reduce(
    (total, call) =>
      total + (Array.isArray(call.output?.recommendations) ? call.output.recommendations.length : 0),
    0,
  )
  const readSources = researchRun.sources.filter((source) => source.status === "read").length
  const unusableSources = researchRun.sources.filter((source) => source.status === "unusable").length
  const searchCalls = lineageCalls.filter(
    (call) => call.toolName.includes("web_search") || call.toolName.includes("web-search"),
  ).length
  const expectedTaskStatus = taskRun.status === "completed" ? "completed" : taskRun.status
  const eventSequenceValid =
    taskRun.events.every((event, index) => event.sequence === index + 1) &&
    taskRun.lastSequence === taskRun.events.length
  const checks: ResearchRunAuditCheck[] = [
    check(
      "event-sequence",
      eventSequenceValid,
      `事件 ${taskRun.events.length} 条，检查点 ${taskRun.lastSequence}。`,
    ),
    check(
      "task-status",
      taskRun.status !== "running" && task.status === expectedTaskStatus,
      `task_run=${taskRun.status}，task_session=${task.status}。`,
    ),
    check(
      "research-policy",
      taskRun.skillId === "research" && taskRun.webSearch === true,
      `skill=${taskRun.skillId ?? "null"}，webSearch=${String(taskRun.webSearch)}。`,
    ),
    check(
      "plan-first",
      Boolean(
        plan && (inheritedPlan || !firstDiscovery || plan.inputSequence < firstDiscovery.inputSequence),
      ),
      inheritedPlan
        ? `从续跑链 ${inheritedRuns.map((run) => run.requestId).join(" → ")} 继承已发布计划；本轮首次检索/阅读位于 ${firstDiscovery?.inputSequence ?? "无"}。`
        : plan
          ? `计划位于事件 ${plan.inputSequence}，首次检索/阅读位于 ${firstDiscovery?.inputSequence ?? "无"}。`
          : "没有 publish-research-plan 调用。",
    ),
    check(
      "multi-round-search",
      searchCalls >= criteria.minimumSearchCalls,
      `搜索 ${searchCalls} 次，要求至少 ${criteria.minimumSearchCalls} 次。`,
    ),
    check(
      "deep-reading",
      readSources >= criteria.minimumReadSources,
      `数据库已读 ${readSources} 个，工具成功读取 ${outputRead} 个。`,
    ),
    check(
      "unusable-sources",
      outputUnusable === unusableSources,
      `数据库不可用 ${unusableSources} 个，工具返回不可用 ${outputUnusable} 个。`,
    ),
    check(
      "evidence-ledger",
      researchRun.evidence.length >= criteria.minimumEvidence,
      `证据 ${researchRun.evidence.length} 条，要求至少 ${criteria.minimumEvidence} 条。`,
    ),
    check(
      "source-curation",
      researchRun.recommendations.length >= criteria.minimumRecommendations,
      `推荐 ${researchRun.recommendations.length} 个，要求至少 ${criteria.minimumRecommendations} 个。`,
    ),
    check(
      "finalization",
      researchRun.phase === "completed" && Boolean(completedFinalization),
      `研究阶段=${researchRun.phase}，结果=${researchRun.outcome ?? "null"}${completedInheritedFinalization && !completedCurrentFinalization ? "，继承祖先完成检查" : ""}。`,
    ),
    check(
      "final-report",
      textCharacters >= criteria.minimumFinalTextCharacters,
      `完成检查后正文 ${textCharacters} 字符，要求至少 ${criteria.minimumFinalTextCharacters}。`,
    ),
    check(
      "database-consistency",
      outputRead === readSources &&
        outputUnusable === unusableSources &&
        outputEvidence === researchRun.evidence.length &&
        outputRecommendations === researchRun.recommendations.length &&
        taskRun.toolCallCount === calls.length,
      `工具/数据库：read ${outputRead}/${readSources}，unusable ${outputUnusable}/${unusableSources}，evidence ${outputEvidence}/${researchRun.evidence.length}，recommend ${outputRecommendations}/${researchRun.recommendations.length}，tool ${calls.length}/${taskRun.toolCallCount ?? "null"}。`,
    ),
  ]

  return {
    checks,
    criteria,
    metrics: {
      durationMs: taskRun.durationMs,
      evidenceCount: researchRun.evidence.length,
      eventCount: taskRun.events.length,
      finalTextCharacters: textCharacters,
      outcome: researchRun.outcome,
      readSourceCount: readSources,
      recommendationCount: researchRun.recommendations.length,
      searchCallCount: searchCalls,
      stepCount: taskRun.stepCount,
      toolCallCount: calls.length,
      totalTokens: taskRun.totalTokens,
      unusableSourceCount: unusableSources,
    },
    passed: checks.every((item) => item.passed),
    resumedFromRequestIds: inheritedRuns.map((run) => run.requestId),
    requestId,
    taskId: taskRun.taskId,
  } as const
}
