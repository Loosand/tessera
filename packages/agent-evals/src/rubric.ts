/**
 * [INPUT]: 五项人工维度分数与统一权重
 * [OUTPUT]: 0–5 的质量分和可直接展示的评分量表
 * [POS]: Agent Eval 的人工质量层；独立于硬门槛和效率层
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentEvalHumanAssessment, AgentEvalHumanDimension } from "./types"

export const AGENT_EVAL_HUMAN_RUBRIC: readonly AgentEvalHumanDimension[] = [
  {
    id: "correctness",
    label: "正确性",
    description: "事实、代码、引用和文件结果是否正确，没有关键错误。",
    weight: 0.35,
  },
  {
    id: "completeness",
    label: "完整性",
    description: "是否覆盖用户要求、关键约束和必要限制，没有漏掉核心交付。",
    weight: 0.2,
  },
  {
    id: "usability",
    label: "可用性",
    description: "结果是否可以直接采用、继续编辑、运行或用于决策。",
    weight: 0.2,
  },
  {
    id: "trustworthiness",
    label: "可信度",
    description: "是否诚实表达不确定性、来源、权限和执行事实，不伪造完成。",
    weight: 0.15,
  },
  {
    id: "clarity",
    label: "清晰度",
    description: "表达是否简洁、结构清楚，并与任务复杂度相称。",
    weight: 0.1,
  },
]

export function humanQualityScore(
  assessment: AgentEvalHumanAssessment,
  rubric: readonly AgentEvalHumanDimension[] = AGENT_EVAL_HUMAN_RUBRIC,
) {
  const totalWeight = rubric.reduce((total, dimension) => total + dimension.weight, 0)
  if (totalWeight <= 0) throw new Error("人工评分权重总和必须大于零。")
  const weighted = rubric.reduce((total, dimension) => {
    const score = assessment.scores[dimension.id]
    if (!Number.isFinite(score) || score < 0 || score > 5 || score * 2 !== Math.round(score * 2)) {
      throw new Error(`人工评分「${dimension.label}」必须是 0–5 之间的 0.5 倍数。`)
    }
    return total + score * dimension.weight
  }, 0)
  return Number((weighted / totalWeight).toFixed(2))
}
