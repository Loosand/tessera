/**
 * [INPUT]: 固定 Eval Suite 与同一 Schema 的多次运行记录
 * [OUTPUT]: 质量优先、可比较中位效率和失败原因的 Markdown 报告
 * [POS]: Agent Eval 的离线聚合与人类可读输出层
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { evaluateAgentEvalRun } from "./evaluate"
import type { AgentEvalRunEvaluation, AgentEvalRunRecord, AgentEvalSuite } from "./types"

function average(values: readonly number[]) {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: readonly number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0)
  return value
}

function decimal(value: number | null, digits = 2) {
  return value === null ? "—" : value.toFixed(digits)
}

function integer(value: number | null) {
  return value === null ? "—" : Math.round(value).toLocaleString("en-US")
}

function percent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`
}

export type AgentEvalCaseSummary = Readonly<{
  averageEfficiency: number | null
  averageHumanScore: number | null
  caseId: string
  excellentCount: number
  hardPassRate: number | null
  medianDurationMs: number | null
  medianTokens: number | null
  medianToolCalls: number | null
  medianTurns: number | null
  runCount: number
}>

export function summarizeAgentEvalRuns(suite: AgentEvalSuite, runs: readonly AgentEvalRunRecord[]) {
  const evaluations = runs.map((run) => evaluateAgentEvalRun(run, suite))
  const evaluationByRunId = new Map(evaluations.map((evaluation) => [evaluation.runId, evaluation]))
  const cases: AgentEvalCaseSummary[] = suite.cases.map((testCase) => {
    const caseRuns = runs.filter((run) => run.caseId === testCase.id)
    const caseEvaluations = caseRuns.map((run) => evaluationByRunId.get(run.runId)).filter(Boolean)
    return {
      caseId: testCase.id,
      runCount: caseRuns.length,
      hardPassRate:
        caseRuns.length === 0
          ? null
          : caseEvaluations.filter((evaluation) => evaluation?.hardGatePassed).length / caseRuns.length,
      averageHumanScore: average(
        caseEvaluations.flatMap((evaluation) =>
          evaluation?.humanScore === null || evaluation?.humanScore === undefined
            ? []
            : [evaluation.humanScore],
        ),
      ),
      averageEfficiency: average(caseEvaluations.map((evaluation) => evaluation?.efficiencyScore ?? 0)),
      medianTurns: median(caseRuns.map((run) => run.metrics.turnCount)),
      medianToolCalls: median(caseRuns.map((run) => run.metrics.toolCallCount)),
      medianTokens: median(
        caseRuns.flatMap((run) => (run.metrics.totalTokens === null ? [] : [run.metrics.totalTokens])),
      ),
      medianDurationMs: median(
        caseRuns.flatMap((run) => (run.metrics.durationMs === null ? [] : [run.metrics.durationMs])),
      ),
      excellentCount: caseEvaluations.filter((evaluation) => evaluation?.grade === "excellent").length,
    }
  })
  return { cases, evaluations }
}

function failedChecks(evaluation: AgentEvalRunEvaluation) {
  return evaluation.checks.filter((result) => !result.passed)
}

export function renderAgentEvalReport(suite: AgentEvalSuite, runs: readonly AgentEvalRunRecord[]) {
  const summary = summarizeAgentEvalRuns(suite, runs)
  const lines = [
    `# ${suite.title} 报告`,
    "",
    `- Suite：\`${suite.id}\` v${suite.version}`,
    `- 运行数：${runs.length}`,
    "- 判定顺序：硬门槛 → 人工质量 → 客观效率；效率不能抵消质量失败。",
    "",
    "## 汇总",
    "",
    "| Case | Runs | 硬门槛通过 | 人工均分 | Turn 中位数 | 工具中位数 | Token 中位数 | 耗时中位数 | 效率均分 | Excellent |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]
  for (const item of summary.cases) {
    lines.push(
      `| ${item.caseId} | ${item.runCount} | ${percent(item.hardPassRate)} | ${decimal(item.averageHumanScore)} | ${integer(item.medianTurns)} | ${integer(item.medianToolCalls)} | ${integer(item.medianTokens)} | ${item.medianDurationMs === null ? "—" : `${(item.medianDurationMs / 1_000).toFixed(1)}s`} | ${decimal(item.averageEfficiency)} | ${item.excellentCount} |`,
    )
  }
  lines.push("", "## 单次运行", "")
  for (const run of runs) {
    const evaluation = summary.evaluations.find((item) => item.runId === run.runId)
    if (!evaluation) continue
    lines.push(
      `### ${run.runId}`,
      "",
      `- Case：\`${run.caseId}\``,
      `- 模型：\`${run.model.providerId}/${run.model.modelId}\``,
      `- 等级：**${evaluation.grade}**`,
      `- 人工质量：${decimal(evaluation.humanScore)} / 5`,
      `- 效率：${decimal(evaluation.efficiencyScore)} / 100；预算${evaluation.budgetPassed ? "通过" : "未通过"}`,
      `- Turn / Tool / Token / 耗时：${run.metrics.turnCount} / ${run.metrics.toolCallCount} / ${integer(run.metrics.totalTokens)} / ${run.metrics.durationMs === null ? "—" : `${(run.metrics.durationMs / 1_000).toFixed(1)}s`}`,
    )
    const failures = failedChecks(evaluation)
    if (failures.length > 0) {
      lines.push("- 硬检查失败：")
      for (const failure of failures) lines.push(`  - ${failure.label}：${failure.details}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}
