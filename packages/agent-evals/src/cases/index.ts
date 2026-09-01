/**
 * [INPUT]: 首批固定黄金任务与统一人工评分量表
 * [OUTPUT]: 唯一公开的 tessera-core v1 Agent Eval Suite
 * [POS]: 评估集目录入口
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { AGENT_EVAL_HUMAN_RUBRIC } from "../rubric"
import { AGENT_EVAL_SCHEMA_VERSION, type AgentEvalSuite } from "../types"
import { TESSERA_CORE_CASES } from "./core-cases"

export const TESSERA_CORE_EVAL_SUITE: AgentEvalSuite = {
  id: "tessera-core",
  version: 1,
  title: "Tessera Core Agent Eval",
  schemaVersion: AGENT_EVAL_SCHEMA_VERSION,
  rubric: AGENT_EVAL_HUMAN_RUBRIC,
  cases: TESSERA_CORE_CASES,
}

export function findAgentEvalCase(caseId: string) {
  return TESSERA_CORE_EVAL_SUITE.cases.find((testCase) => testCase.id === caseId) ?? null
}
