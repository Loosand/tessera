/**
 * [INPUT]: tessera-core 固定目录、代表性运行记录、TaskRunInspection 与人工评分
 * [OUTPUT]: Case 稳定性、质量优先分级、50/10 Turn 效率差、硬检查、解析和报告回归
 * [POS]: @tessera/agent-evals 的跨模块验收测试
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskRunInspection } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import exampleRunRecord from "../examples/direct-answer-run.example.json"
import { TESSERA_CORE_EVAL_SUITE } from "./cases"
import { evaluateAgentEfficiency, evaluateAgentEvalRun, validateAgentEvalSuite } from "./evaluate"
import { agentEvalMetricsFromInspection } from "./inspection"
import { parseAgentEvalRunRecords } from "./parse"
import { renderAgentEvalReport } from "./report"
import type {
  AgentEvalEfficiencyBudget,
  AgentEvalHumanAssessment,
  AgentEvalRunMetrics,
  AgentEvalRunRecord,
} from "./types"

const perfectHumanScore: AgentEvalHumanAssessment = {
  evaluator: "maintainer",
  notes: "结果完整、准确且可直接使用。",
  scores: {
    correctness: 5,
    completeness: 5,
    usability: 5,
    clarity: 5,
    trustworthiness: 5,
  },
}

function directAnswerRun(overrides: Partial<AgentEvalRunRecord> = {}): AgentEvalRunRecord {
  return {
    schemaVersion: 1,
    suiteId: "tessera-core",
    suiteVersion: 1,
    caseId: "direct-answer-side-effects-v1",
    runId: "direct-run-1",
    model: { providerId: "test", modelId: "model" },
    revision: { gitCommit: "abc123" },
    observed: {
      answer: "工具可能已经产生副作用；最终回答失败时，重试不能盲目重复已经成功的工具调用。",
      appliedEventIds: [],
      files: {},
      safetyViolations: [],
      terminal: "finish",
      tools: [],
    },
    metrics: {
      turnCount: 1,
      toolCallCount: 0,
      toolFailureCount: 0,
      repeatedToolCallCount: 0,
      totalTokens: 300,
      durationMs: 5_000,
      userCorrectionCount: 0,
    },
    humanAssessment: perfectHumanScore,
    ...overrides,
  }
}

describe("版本化评估集", () => {
  it("固定六类黄金任务、唯一版本 ID 与合法预算", () => {
    expect(validateAgentEvalSuite(TESSERA_CORE_EVAL_SUITE)).toBe(TESSERA_CORE_EVAL_SUITE)
    expect(TESSERA_CORE_EVAL_SUITE.cases.map((testCase) => testCase.category)).toEqual([
      "direct-answer",
      "workspace",
      "editing",
      "test-fix",
      "research",
      "recovery",
    ])
    expect(new Set(TESSERA_CORE_EVAL_SUITE.cases.map((testCase) => testCase.id)).size).toBe(6)
  })

  it("先过硬门槛和人工质量，再给高效率运行 excellent", () => {
    const evaluation = evaluateAgentEvalRun(directAnswerRun(), TESSERA_CORE_EVAL_SUITE)

    expect(evaluation).toMatchObject({
      hardGatePassed: true,
      humanScore: 5,
      qualityPassed: true,
      budgetPassed: true,
      grade: "excellent",
    })
    expect(evaluation.efficiencyScore).toBe(100)
  })

  it("相同满分质量下，10 Turn 的效率显著高于 50 Turn", () => {
    const metric = (target: number, maximum: number) => ({ target, maximum })
    const budget: AgentEvalEfficiencyBudget = {
      turns: metric(10, 50),
      toolCalls: metric(10, 20),
      toolFailures: metric(0, 2),
      repeatedToolCalls: metric(0, 3),
      totalTokens: metric(10_000, 50_000),
      durationMs: metric(60_000, 300_000),
      userCorrections: metric(0, 2),
    }
    const metrics: AgentEvalRunMetrics = {
      turnCount: 10,
      toolCallCount: 10,
      toolFailureCount: 0,
      repeatedToolCallCount: 0,
      totalTokens: 10_000,
      durationMs: 60_000,
      userCorrectionCount: 0,
    }
    const fast = evaluateAgentEfficiency(metrics, budget)
    const slow = evaluateAgentEfficiency({ ...metrics, turnCount: 50 }, budget)

    expect(fast.efficiencyScore).toBe(100)
    expect(slow.efficiencyScore).toBe(70)
    expect(fast.efficiencyScore).toBeGreaterThan(slow.efficiencyScore)
  })

  it("硬检查拒绝额外文件变化，不能用人工满分抵消", () => {
    const run = directAnswerRun({
      observed: {
        ...directAnswerRun().observed,
        files: { "unexpected.md": "不应出现" },
      },
    })
    const evaluation = evaluateAgentEvalRun(run, TESSERA_CORE_EVAL_SUITE)

    expect(evaluation.humanScore).toBe(5)
    expect(evaluation.hardGatePassed).toBe(false)
    expect(evaluation.grade).toBe("failed")
    expect(evaluation.checks).toContainEqual(
      expect.objectContaining({ id: "allowed-file-changes", passed: false }),
    )
  })

  it("冲突恢复 Case 要求脚本事件、失败事实、重新读取和最终精确文件", () => {
    const testCase = TESSERA_CORE_EVAL_SUITE.cases.find(
      (candidate) => candidate.id === "file-conflict-recovery-v1",
    )
    if (!testCase?.expected.expectedFiles) throw new Error("缺少冲突恢复 Case。")
    const run: AgentEvalRunRecord = {
      ...directAnswerRun(),
      caseId: testCase.id,
      runId: "conflict-run-1",
      observed: {
        answer: "第一次编辑发生冲突；重新读取后已保留外部字段并更新 status。",
        appliedEventIds: ["external-owner-update"],
        files: { "status.md": testCase.expected.expectedFiles["status.md"] ?? "" },
        safetyViolations: [],
        terminal: "finish",
        tools: [
          { name: "read", status: "success" },
          { name: "edit", status: "failure" },
          { name: "read", status: "success" },
          { name: "edit", status: "success" },
        ],
      },
      metrics: {
        turnCount: 6,
        toolCallCount: 4,
        toolFailureCount: 1,
        repeatedToolCallCount: 0,
        totalTokens: 3_000,
        durationMs: 40_000,
        userCorrectionCount: 0,
      },
    }

    expect(evaluateAgentEvalRun(run, TESSERA_CORE_EVAL_SUITE)).toMatchObject({
      hardGatePassed: true,
      grade: "excellent",
    })
  })
})

describe("运行事实适配、解析与报告", () => {
  it("从 Run Inspector 提取 Turn、工具失败、Token 与耗时", () => {
    const inspection = {
      lifecycle: { turnCount: 7 },
      execution: { toolCallCount: 4 },
      tools: [
        { name: "read", callCount: 2, failureCount: 0, denialCount: 0 },
        { name: "edit", callCount: 2, failureCount: 1, denialCount: 0 },
      ],
      usage: { totalTokens: 2_400 },
      timing: { durationMs: 42_000 },
    } as TaskRunInspection

    expect(agentEvalMetricsFromInspection(inspection, { repeatedToolCallCount: 1 })).toEqual({
      turnCount: 7,
      toolCallCount: 4,
      toolFailureCount: 1,
      repeatedToolCallCount: 1,
      totalTokens: 2_400,
      durationMs: 42_000,
      userCorrectionCount: 0,
    })
  })

  it("解析 JSON 运行记录并拒绝缺失的人工评分维度", () => {
    const run = directAnswerRun()
    expect(parseAgentEvalRunRecords({ runs: [run] })).toHaveLength(1)
    expect(parseAgentEvalRunRecords(exampleRunRecord)).toHaveLength(1)
    const invalid = JSON.parse(JSON.stringify(run)) as Record<string, unknown>
    const assessment = invalid.humanAssessment as { scores: Record<string, unknown> }
    assessment.scores.correctness = undefined

    expect(() => parseAgentEvalRunRecords([invalid])).toThrow("correctness")
  })

  it("报告同时呈现人工质量与 Turn、工具、Token、耗时", () => {
    const report = renderAgentEvalReport(TESSERA_CORE_EVAL_SUITE, [directAnswerRun()])

    expect(report).toContain("硬门槛 → 人工质量 → 客观效率")
    expect(report).toContain("direct-answer-side-effects-v1")
    expect(report).toContain("人工质量：5.00 / 5")
    expect(report).toContain("1 / 0 / 300 / 5.0s")
    expect(report).toContain("| workspace-fact-summary-v1 | 0 | — |")
  })
})
