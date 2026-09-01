/**
 * [INPUT]: 版本化黄金任务、真实 Run Inspector 指标、最终快照与人工评分
 * [OUTPUT]: @tessera/agent-evals 的目录、解析、评估、聚合与报告公开 API
 * [POS]: Agent Eval 包公开入口
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export { TESSERA_CORE_EVAL_SUITE, findAgentEvalCase } from "./cases"
export {
  evaluateAgentEfficiency,
  evaluateAgentEvalRun,
  evaluateAgentHardChecks,
  validateAgentEvalSuite,
} from "./evaluate"
export { agentEvalMetricsFromInspection } from "./inspection"
export { parseAgentEvalRunRecords } from "./parse"
export { AGENT_EVAL_HUMAN_RUBRIC, humanQualityScore } from "./rubric"
export {
  type AgentEvalCaseSummary,
  renderAgentEvalReport,
  summarizeAgentEvalRuns,
} from "./report"
export {
  AGENT_EVAL_HUMAN_DIMENSION_IDS,
  AGENT_EVAL_SCHEMA_VERSION,
  type AgentEvalCase,
  type AgentEvalCheckResult,
  type AgentEvalEfficiencyBudget,
  type AgentEvalEfficiencyComponent,
  type AgentEvalExpectedOutcome,
  type AgentEvalHumanAssessment,
  type AgentEvalHumanDimension,
  type AgentEvalHumanDimensionId,
  type AgentEvalMetricBudget,
  type AgentEvalObservedOutcome,
  type AgentEvalRunEvaluation,
  type AgentEvalRunMetrics,
  type AgentEvalRunRecord,
  type AgentEvalScriptedEvent,
  type AgentEvalSuite,
  type AgentEvalToolObservation,
} from "./types"
