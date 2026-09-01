/**
 * [INPUT]: 产品已有 TaskRunInspection 与评估运行中额外记录的重复调用/用户纠正数
 * [OUTPUT]: Agent Eval 使用的供应商无关客观指标
 * [POS]: 产品运行事实到离线评估记录之间的窄适配层
 * [DOC]: docs/quality/agent-eval-method.md、docs/architecture/agent-run-reliability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskRunInspection } from "@tessera/contracts"
import type { AgentEvalRunMetrics } from "./types"

export function agentEvalMetricsFromInspection(
  inspection: TaskRunInspection,
  additions: Readonly<{
    repeatedToolCallCount?: number | undefined
    userCorrectionCount?: number | undefined
  }> = {},
): AgentEvalRunMetrics {
  return {
    turnCount: inspection.lifecycle.turnCount,
    toolCallCount:
      inspection.execution.toolCallCount ?? inspection.tools.reduce((sum, tool) => sum + tool.callCount, 0),
    toolFailureCount: inspection.tools.reduce((sum, tool) => sum + tool.failureCount, 0),
    repeatedToolCallCount: additions.repeatedToolCallCount ?? 0,
    totalTokens: inspection.usage.totalTokens,
    durationMs: inspection.timing.durationMs,
    userCorrectionCount: additions.userCorrectionCount ?? 0,
  }
}
