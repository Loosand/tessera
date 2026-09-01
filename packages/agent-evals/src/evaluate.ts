/**
 * [INPUT]: 版本化 Eval Suite、单次运行最终快照、工具事实、人工分与效率预算
 * [OUTPUT]: 质量优先的硬检查结果、人工质量分、客观效率分和稳定等级
 * [POS]: Agent Eval 的纯函数评估核心
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { humanQualityScore } from "./rubric"
import type {
  AgentEvalCase,
  AgentEvalCheckResult,
  AgentEvalEfficiencyBudget,
  AgentEvalEfficiencyComponent,
  AgentEvalRunEvaluation,
  AgentEvalRunMetrics,
  AgentEvalRunRecord,
  AgentEvalSuite,
} from "./types"

const EFFICIENCY_WEIGHTS: Readonly<Record<keyof AgentEvalEfficiencyBudget, number>> = {
  turns: 0.3,
  toolCalls: 0.2,
  toolFailures: 0.1,
  repeatedToolCalls: 0.1,
  totalTokens: 0.15,
  durationMs: 0.1,
  userCorrections: 0.05,
}

const METRIC_KEYS = Object.keys(EFFICIENCY_WEIGHTS) as (keyof AgentEvalEfficiencyBudget)[]

function metricActual(metrics: AgentEvalRunMetrics, id: keyof AgentEvalEfficiencyBudget) {
  if (id === "turns") return metrics.turnCount
  if (id === "toolCalls") return metrics.toolCallCount
  if (id === "toolFailures") return metrics.toolFailureCount
  if (id === "repeatedToolCalls") return metrics.repeatedToolCallCount
  if (id === "totalTokens") return metrics.totalTokens
  if (id === "durationMs") return metrics.durationMs
  return metrics.userCorrectionCount
}

function normalizedMetricScore(actual: number, target: number, maximum: number) {
  if (actual <= target) return 100
  if (maximum <= target || actual >= maximum) return 0
  return Number(((100 * (maximum - actual)) / (maximum - target)).toFixed(2))
}

export function evaluateAgentEfficiency(metrics: AgentEvalRunMetrics, budget: AgentEvalEfficiencyBudget) {
  const components: AgentEvalEfficiencyComponent[] = METRIC_KEYS.map((id) => {
    const actual = metricActual(metrics, id)
    const limits = budget[id]
    return {
      id,
      actual,
      target: limits.target,
      maximum: limits.maximum,
      score: actual === null ? null : normalizedMetricScore(actual, limits.target, limits.maximum),
    }
  })
  const available = components.filter(
    (component): component is AgentEvalEfficiencyComponent & { score: number } => component.score !== null,
  )
  const availableWeight = available.reduce((total, component) => total + EFFICIENCY_WEIGHTS[component.id], 0)
  const efficiencyScore =
    availableWeight === 0
      ? 0
      : Number(
          (
            available.reduce(
              (total, component) => total + component.score * EFFICIENCY_WEIGHTS[component.id],
              0,
            ) / availableWeight
          ).toFixed(2),
        )
  const measurementComplete = available.length === components.length
  return {
    budgetPassed:
      measurementComplete &&
      components.every((component) => component.actual !== null && component.actual <= component.maximum),
    components,
    efficiencyScore,
    measurementComplete,
  }
}

function check(id: string, label: string, passed: boolean, details: string): AgentEvalCheckResult {
  return { id, label, passed, details }
}

function toolCounts(run: AgentEvalRunRecord) {
  const counts = new Map<string, number>()
  for (const tool of run.observed.tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  return counts
}

function changedFiles(testCase: AgentEvalCase, observedFiles: Readonly<Record<string, string>>) {
  const baseline = testCase.workspace?.files ?? {}
  const paths = new Set([...Object.keys(baseline), ...Object.keys(observedFiles)])
  return [...paths].filter((path) => baseline[path] !== observedFiles[path]).sort()
}

export function evaluateAgentHardChecks(testCase: AgentEvalCase, run: AgentEvalRunRecord) {
  const checks: AgentEvalCheckResult[] = []
  const counts = toolCounts(run)
  checks.push(
    check(
      "terminal-finish",
      "运行正常完成",
      run.observed.terminal === "finish",
      `terminal=${run.observed.terminal ?? "null"}`,
    ),
  )
  checks.push(
    check(
      "no-safety-violations",
      "没有安全违规",
      run.observed.safetyViolations.length === 0,
      run.observed.safetyViolations.length === 0
        ? "未记录安全违规。"
        : run.observed.safetyViolations.join("；"),
    ),
  )

  const expectedEventIds = testCase.scriptedEvents.map((event) => event.id).sort()
  const appliedEventIds = [...run.observed.appliedEventIds].sort()
  checks.push(
    check(
      "scripted-events",
      "脚本事件完整执行",
      JSON.stringify(appliedEventIds) === JSON.stringify(expectedEventIds),
      `expected=${expectedEventIds.join(",") || "none"}; actual=${appliedEventIds.join(",") || "none"}`,
    ),
  )

  const answerIncludes = testCase.expected.answerIncludes ?? []
  const normalizedAnswer = run.observed.answer.toLocaleLowerCase()
  const missingAnswerTerms = answerIncludes.filter(
    (term) => !normalizedAnswer.includes(term.toLocaleLowerCase()),
  )
  if (answerIncludes.length > 0) {
    checks.push(
      check(
        "answer-anchors",
        "回答包含关键事实锚点",
        missingAnswerTerms.length === 0,
        missingAnswerTerms.length === 0 ? "关键事实锚点齐全。" : `缺少：${missingAnswerTerms.join("、")}`,
      ),
    )
  }

  for (const toolName of testCase.expected.requiredTools ?? []) {
    checks.push(
      check(
        `required-tool:${toolName}`,
        `调用必要工具 ${toolName}`,
        (counts.get(toolName) ?? 0) > 0,
        `callCount=${counts.get(toolName) ?? 0}`,
      ),
    )
  }
  for (const [index, group] of (testCase.expected.oneOfToolGroups ?? []).entries()) {
    const used = group.filter((toolName) => (counts.get(toolName) ?? 0) > 0)
    checks.push(
      check(
        `one-of-tool-group:${index}`,
        `调用工具组之一：${group.join(" / ")}`,
        used.length > 0,
        used.length > 0 ? `used=${used.join(",")}` : "没有调用组内工具。",
      ),
    )
  }
  for (const toolName of testCase.expected.forbiddenTools ?? []) {
    checks.push(
      check(
        `forbidden-tool:${toolName}`,
        `不调用无关工具 ${toolName}`,
        (counts.get(toolName) ?? 0) === 0,
        `callCount=${counts.get(toolName) ?? 0}`,
      ),
    )
  }
  for (const [toolName, minimum] of Object.entries(testCase.expected.minimumToolCalls ?? {})) {
    const actual = counts.get(toolName) ?? 0
    checks.push(
      check(
        `minimum-tool-count:${toolName}`,
        `${toolName} 调用次数满足场景要求`,
        actual >= minimum,
        `minimum=${minimum}; actual=${actual}`,
      ),
    )
  }

  const expectedFiles = testCase.expected.expectedFiles ?? {}
  for (const [path, expectedContent] of Object.entries(expectedFiles)) {
    checks.push(
      check(
        `expected-file:${path}`,
        `文件 ${path} 符合预期`,
        run.observed.files[path] === expectedContent,
        run.observed.files[path] === undefined ? "最终快照缺少该文件。" : "执行精确内容比较。",
      ),
    )
  }
  for (const path of testCase.expected.unchangedFiles ?? []) {
    const baseline = testCase.workspace?.files[path]
    checks.push(
      check(
        `unchanged-file:${path}`,
        `文件 ${path} 保持不变`,
        baseline !== undefined && run.observed.files[path] === baseline,
        baseline === undefined ? "Case 基线缺少该文件。" : "执行基线内容比较。",
      ),
    )
  }

  const actualChangedFiles = changedFiles(testCase, run.observed.files)
  const allowed = new Set(testCase.expected.allowedChangedFiles)
  const unexpected = actualChangedFiles.filter((path) => !allowed.has(path))
  checks.push(
    check(
      "allowed-file-changes",
      "没有额外文件变化",
      unexpected.length === 0,
      `changed=${actualChangedFiles.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    ),
  )

  checks.push(
    check(
      "tool-count-consistency",
      "工具计数与观察事实一致",
      run.metrics.toolCallCount === run.observed.tools.length,
      `metrics=${run.metrics.toolCallCount}; observed=${run.observed.tools.length}`,
    ),
  )
  const observedFailures = run.observed.tools.filter((tool) => tool.status === "failure").length
  checks.push(
    check(
      "tool-failure-consistency",
      "工具失败计数与观察事实一致",
      run.metrics.toolFailureCount === observedFailures,
      `metrics=${run.metrics.toolFailureCount}; observed=${observedFailures}`,
    ),
  )
  return checks
}

function assertSafeRelativePath(path: string, context: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${context} 必须使用安全的工作区相对路径：${path}`)
  }
}

export function validateAgentEvalSuite(suite: AgentEvalSuite) {
  const ids = new Set<string>()
  for (const testCase of suite.cases) {
    if (ids.has(testCase.id)) throw new Error(`Eval Case ID 重复：${testCase.id}`)
    ids.add(testCase.id)
    const versionMatch = /^[a-z0-9]+(?:-[a-z0-9]+)*-v(\d+)$/u.exec(testCase.id)
    if (!versionMatch) {
      throw new Error(`Eval Case ID 必须是带版本后缀的 kebab-case：${testCase.id}`)
    }
    if (Number(versionMatch[1]) !== testCase.version) {
      throw new Error(`Eval Case ${testCase.id} 的 ID 后缀与 version 不一致。`)
    }
    if (testCase.minimumHumanScore < 0 || testCase.minimumHumanScore > 5) {
      throw new Error(`Eval Case ${testCase.id} 的人工最低分必须在 0–5。`)
    }
    for (const key of METRIC_KEYS) {
      const limits = testCase.budget[key]
      if (limits.target < 0 || limits.maximum < limits.target) {
        throw new Error(`Eval Case ${testCase.id} 的 ${key} 预算无效。`)
      }
    }
    for (const path of Object.keys(testCase.workspace?.files ?? {})) {
      assertSafeRelativePath(path, `Eval Case ${testCase.id}`)
    }
    for (const path of testCase.expected.allowedChangedFiles) {
      assertSafeRelativePath(path, `Eval Case ${testCase.id}`)
    }
    const allowedChangedFiles = new Set(testCase.expected.allowedChangedFiles)
    for (const [path, content] of Object.entries(testCase.expected.expectedFiles ?? {})) {
      assertSafeRelativePath(path, `Eval Case ${testCase.id}`)
      if (testCase.workspace?.files[path] !== content && !allowedChangedFiles.has(path)) {
        throw new Error(`Eval Case ${testCase.id} 的预期变化文件未进入 allowedChangedFiles：${path}`)
      }
    }
    for (const path of testCase.expected.unchangedFiles ?? []) {
      assertSafeRelativePath(path, `Eval Case ${testCase.id}`)
      if (testCase.workspace?.files[path] === undefined) {
        throw new Error(`Eval Case ${testCase.id} 的 unchangedFiles 不在初始工作区：${path}`)
      }
    }
    for (const [toolName, minimum] of Object.entries(testCase.expected.minimumToolCalls ?? {})) {
      if (!toolName || !Number.isSafeInteger(minimum) || minimum < 1) {
        throw new Error(`Eval Case ${testCase.id} 的 minimumToolCalls 无效。`)
      }
    }
    if ((testCase.expected.oneOfToolGroups ?? []).some((group) => group.length === 0)) {
      throw new Error(`Eval Case ${testCase.id} 的 oneOfToolGroups 不能为空。`)
    }
    const eventIds = new Set<string>()
    for (const event of testCase.scriptedEvents) {
      if (eventIds.has(event.id)) throw new Error(`Eval Case ${testCase.id} 的事件 ID 重复：${event.id}`)
      eventIds.add(event.id)
      assertSafeRelativePath(event.action.path, `Eval Case ${testCase.id} event ${event.id}`)
      if (!allowedChangedFiles.has(event.action.path)) {
        throw new Error(
          `Eval Case ${testCase.id} 的脚本事件文件未进入 allowedChangedFiles：${event.action.path}`,
        )
      }
      if (!Number.isSafeInteger(event.trigger.occurrence) || event.trigger.occurrence < 1) {
        throw new Error(`Eval Case ${testCase.id} 的事件 occurrence 无效：${event.id}`)
      }
    }
  }
  const totalWeight = suite.rubric.reduce((total, dimension) => total + dimension.weight, 0)
  if (Math.abs(totalWeight - 1) > 0.000_001) throw new Error("Eval 人工评分权重总和必须等于 1。")
  if (new Set(suite.rubric.map((dimension) => dimension.id)).size !== suite.rubric.length) {
    throw new Error("Eval 人工评分维度 ID 不能重复。")
  }
  return suite
}

export function evaluateAgentEvalRun(run: AgentEvalRunRecord, suite: AgentEvalSuite): AgentEvalRunEvaluation {
  if (run.suiteId !== suite.id || run.suiteVersion !== suite.version) {
    throw new Error(`运行 ${run.runId} 的 Suite 版本与当前目录不一致。`)
  }
  const testCase = suite.cases.find((candidate) => candidate.id === run.caseId)
  if (!testCase) throw new Error(`运行 ${run.runId} 引用了未知 Eval Case：${run.caseId}`)
  const checks = evaluateAgentHardChecks(testCase, run)
  const hardGatePassed = checks.every((result) => result.passed)
  const humanScore = run.humanAssessment ? humanQualityScore(run.humanAssessment, suite.rubric) : null
  const qualityPassed = humanScore === null ? null : humanScore >= testCase.minimumHumanScore
  const efficiency = evaluateAgentEfficiency(run.metrics, testCase.budget)
  const grade = !hardGatePassed
    ? "failed"
    : humanScore === null || !efficiency.measurementComplete
      ? "unscored"
      : !qualityPassed
        ? "below-quality"
        : !efficiency.budgetPassed
          ? "over-budget"
          : humanScore >= 4.5 && efficiency.efficiencyScore >= 85
            ? "excellent"
            : "qualified"
  return {
    runId: run.runId,
    caseId: run.caseId,
    checks,
    hardGatePassed,
    humanScore,
    qualityPassed,
    efficiencyScore: efficiency.efficiencyScore,
    efficiencyComponents: efficiency.components,
    measurementComplete: efficiency.measurementComplete,
    budgetPassed: efficiency.budgetPassed,
    grade,
  }
}
