/**
 * [INPUT]: CLI 从本地 JSON 读取的未知值
 * [OUTPUT]: 经字段、枚举、范围和完整人工评分校验的 AgentEvalRunRecord 列表
 * [POS]: 不可信本地评估记录进入评分核心前的运行时边界
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  AGENT_EVAL_HUMAN_DIMENSION_IDS,
  AGENT_EVAL_SCHEMA_VERSION,
  type AgentEvalHumanAssessment,
  type AgentEvalObservedOutcome,
  type AgentEvalRunMetrics,
  type AgentEvalRunRecord,
  type AgentEvalToolObservation,
} from "./types"

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 必须是非空字符串。`)
  return value
}

function text(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串。`)
  return value
}

function finiteNumber(value: unknown, label: string): number
function finiteNumber(value: unknown, label: string, nullable: true): number | null
function finiteNumber(value: unknown, label: string, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须是非负有限数值${nullable ? "或 null" : ""}。`)
  }
  return value
}

function integer(value: unknown, label: string) {
  const parsed = finiteNumber(value, label)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} 必须是安全整数。`)
  return parsed
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} 必须是字符串数组。`)
  }
  return value
}

function stringMap(value: unknown, label: string) {
  const source = record(value, label)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(source)) {
    if (typeof item !== "string") throw new Error(`${label}.${key} 必须是字符串。`)
    result[key] = item
  }
  return result
}

function parseTools(value: unknown, label: string): AgentEvalToolObservation[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`)
  return value.map((item, index) => {
    const source = record(item, `${label}[${index}]`)
    const status = source.status
    if (status !== "success" && status !== "failure" && status !== "denied") {
      throw new Error(`${label}[${index}].status 无效。`)
    }
    return {
      name: string(source.name, `${label}[${index}].name`),
      status,
      ...(typeof source.signature === "string" ? { signature: source.signature } : {}),
    }
  })
}

function parseObserved(value: unknown, label: string): AgentEvalObservedOutcome {
  const source = record(value, label)
  const terminal = source.terminal
  if (terminal !== null && terminal !== "abort" && terminal !== "error" && terminal !== "finish") {
    throw new Error(`${label}.terminal 无效。`)
  }
  return {
    answer: text(source.answer, `${label}.answer`),
    appliedEventIds: stringArray(source.appliedEventIds, `${label}.appliedEventIds`),
    files: stringMap(source.files, `${label}.files`),
    safetyViolations: stringArray(source.safetyViolations, `${label}.safetyViolations`),
    terminal,
    tools: parseTools(source.tools, `${label}.tools`),
  }
}

function parseMetrics(value: unknown, label: string): AgentEvalRunMetrics {
  const source = record(value, label)
  return {
    turnCount: integer(source.turnCount, `${label}.turnCount`),
    toolCallCount: integer(source.toolCallCount, `${label}.toolCallCount`),
    toolFailureCount: integer(source.toolFailureCount, `${label}.toolFailureCount`),
    repeatedToolCallCount: integer(source.repeatedToolCallCount, `${label}.repeatedToolCallCount`),
    totalTokens: finiteNumber(source.totalTokens, `${label}.totalTokens`, true),
    durationMs: finiteNumber(source.durationMs, `${label}.durationMs`, true),
    userCorrectionCount: integer(source.userCorrectionCount, `${label}.userCorrectionCount`),
  }
}

function parseHumanAssessment(value: unknown, label: string): AgentEvalHumanAssessment {
  const source = record(value, label)
  const rawScores = record(source.scores, `${label}.scores`)
  const scores = {} as Record<(typeof AGENT_EVAL_HUMAN_DIMENSION_IDS)[number], number>
  for (const id of AGENT_EVAL_HUMAN_DIMENSION_IDS) {
    const score = finiteNumber(rawScores[id], `${label}.scores.${id}`)
    if (score > 5 || score * 2 !== Math.round(score * 2)) {
      throw new Error(`${label}.scores.${id} 必须是 0–5 之间的 0.5 倍数。`)
    }
    scores[id] = score
  }
  return {
    evaluator: string(source.evaluator, `${label}.evaluator`),
    notes: typeof source.notes === "string" ? source.notes : "",
    scores,
  }
}

function parseRun(value: unknown, index: number): AgentEvalRunRecord {
  const label = `runs[${index}]`
  const source = record(value, label)
  if (source.schemaVersion !== AGENT_EVAL_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion 必须是 ${AGENT_EVAL_SCHEMA_VERSION}。`)
  }
  const model = record(source.model, `${label}.model`)
  const revision = record(source.revision, `${label}.revision`)
  return {
    schemaVersion: AGENT_EVAL_SCHEMA_VERSION,
    suiteId: string(source.suiteId, `${label}.suiteId`),
    suiteVersion: integer(source.suiteVersion, `${label}.suiteVersion`),
    caseId: string(source.caseId, `${label}.caseId`),
    runId: string(source.runId, `${label}.runId`),
    model: {
      providerId: string(model.providerId, `${label}.model.providerId`),
      modelId: string(model.modelId, `${label}.model.modelId`),
    },
    revision: {
      gitCommit: string(revision.gitCommit, `${label}.revision.gitCommit`),
      ...(typeof revision.promptVersion === "string" ? { promptVersion: revision.promptVersion } : {}),
    },
    observed: parseObserved(source.observed, `${label}.observed`),
    metrics: parseMetrics(source.metrics, `${label}.metrics`),
    ...(source.humanAssessment === undefined
      ? {}
      : { humanAssessment: parseHumanAssessment(source.humanAssessment, `${label}.humanAssessment`) }),
  }
}

export function parseAgentEvalRunRecords(value: unknown) {
  const rawRuns = Array.isArray(value) ? value : record(value, "评估结果").runs
  if (!Array.isArray(rawRuns)) throw new Error("评估结果必须是数组或包含 runs 数组的对象。")
  return rawRuns.map(parseRun)
}
