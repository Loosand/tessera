/**
 * [INPUT]: Agent 黄金任务、真实运行最终快照、工具事实、客观指标与人工评分
 * [OUTPUT]: 与模型供应商和执行宿主无关的版本化 Eval 类型契约
 * [POS]: agent-evals 包的稳定数据模型
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const AGENT_EVAL_SCHEMA_VERSION = 1 as const

export const AGENT_EVAL_HUMAN_DIMENSION_IDS = [
  "correctness",
  "completeness",
  "usability",
  "clarity",
  "trustworthiness",
] as const

export type AgentEvalHumanDimensionId = (typeof AGENT_EVAL_HUMAN_DIMENSION_IDS)[number]

export type AgentEvalHumanDimension = Readonly<{
  description: string
  id: AgentEvalHumanDimensionId
  label: string
  weight: number
}>

export type AgentEvalMetricBudget = Readonly<{
  maximum: number
  target: number
}>

export type AgentEvalEfficiencyBudget = Readonly<{
  durationMs: AgentEvalMetricBudget
  repeatedToolCalls: AgentEvalMetricBudget
  toolCalls: AgentEvalMetricBudget
  toolFailures: AgentEvalMetricBudget
  totalTokens: AgentEvalMetricBudget
  turns: AgentEvalMetricBudget
  userCorrections: AgentEvalMetricBudget
}>

export type AgentEvalScriptedEvent = Readonly<{
  action: Readonly<{
    content: string
    path: string
    type: "replace-file"
  }>
  id: string
  trigger: Readonly<{
    occurrence: number
    phase: "after-result"
    toolName: string
  }>
}>

export type AgentEvalExpectedOutcome = Readonly<{
  allowedChangedFiles: readonly string[]
  answerIncludes?: readonly string[] | undefined
  expectedFiles?: Readonly<Record<string, string>> | undefined
  forbiddenTools?: readonly string[] | undefined
  minimumToolCalls?: Readonly<Record<string, number>> | undefined
  oneOfToolGroups?: readonly (readonly string[])[] | undefined
  requiredTools?: readonly string[] | undefined
  unchangedFiles?: readonly string[] | undefined
}>

export type AgentEvalCase = Readonly<{
  budget: AgentEvalEfficiencyBudget
  category: "direct-answer" | "workspace" | "editing" | "test-fix" | "research" | "recovery"
  expected: AgentEvalExpectedOutcome
  humanGuidance: readonly string[]
  id: string
  minimumHumanScore: number
  prompt: string
  scriptedEvents: readonly AgentEvalScriptedEvent[]
  tags: readonly string[]
  title: string
  version: number
  workspace: Readonly<{ files: Readonly<Record<string, string>> }> | null
}>

export type AgentEvalSuite = Readonly<{
  cases: readonly AgentEvalCase[]
  id: string
  rubric: readonly AgentEvalHumanDimension[]
  schemaVersion: typeof AGENT_EVAL_SCHEMA_VERSION
  title: string
  version: number
}>

export type AgentEvalToolObservation = Readonly<{
  name: string
  signature?: string | undefined
  status: "success" | "failure" | "denied"
}>

export type AgentEvalObservedOutcome = Readonly<{
  answer: string
  appliedEventIds: readonly string[]
  files: Readonly<Record<string, string>>
  safetyViolations: readonly string[]
  terminal: "abort" | "error" | "finish" | null
  tools: readonly AgentEvalToolObservation[]
}>

export type AgentEvalRunMetrics = Readonly<{
  durationMs: number | null
  repeatedToolCallCount: number
  toolCallCount: number
  toolFailureCount: number
  totalTokens: number | null
  turnCount: number
  userCorrectionCount: number
}>

export type AgentEvalHumanAssessment = Readonly<{
  evaluator: string
  notes: string
  scores: Readonly<Record<AgentEvalHumanDimensionId, number>>
}>

export type AgentEvalRunRecord = Readonly<{
  caseId: string
  humanAssessment?: AgentEvalHumanAssessment | undefined
  metrics: AgentEvalRunMetrics
  model: Readonly<{
    modelId: string
    providerId: string
  }>
  observed: AgentEvalObservedOutcome
  revision: Readonly<{
    gitCommit: string
    promptVersion?: string | undefined
  }>
  runId: string
  schemaVersion: typeof AGENT_EVAL_SCHEMA_VERSION
  suiteId: string
  suiteVersion: number
}>

export type AgentEvalCheckResult = Readonly<{
  details: string
  id: string
  label: string
  passed: boolean
}>

export type AgentEvalEfficiencyComponent = Readonly<{
  actual: number | null
  id: keyof AgentEvalEfficiencyBudget
  maximum: number
  score: number | null
  target: number
}>

export type AgentEvalRunEvaluation = Readonly<{
  budgetPassed: boolean
  caseId: string
  checks: readonly AgentEvalCheckResult[]
  efficiencyComponents: readonly AgentEvalEfficiencyComponent[]
  efficiencyScore: number
  grade: "failed" | "unscored" | "below-quality" | "over-budget" | "qualified" | "excellent"
  hardGatePassed: boolean
  humanScore: number | null
  measurementComplete: boolean
  qualityPassed: boolean | null
  runId: string
}>
