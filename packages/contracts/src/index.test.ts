/**
 * [INPUT]: 根入口重新导出的运行时守卫与合法、畸形 RunPolicy/ContextManifest/资源摘要/供应商错误样例
 * [OUTPUT]: 领域拆分后共享契约仍拒绝非法资源限制、上下文预算/压缩 marker、Skill ID、研究网络模式与超界供应商错误正文的回归验证
 * [POS]: @tessera/contracts 根入口与 task-run-policy 领域文件之间的运行时回归测试
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/ai-observability.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  type TaskRunPolicy,
  isResearchNetworkMode,
  isTaskRunPolicy,
  isTaskRunErrorDataV1,
  isTaskRunResourceSummary,
  isTaskSkillId,
  isUserTaskSkillId,
} from "./index"

describe("共享运行错误契约", () => {
  const failure = {
    code: "invalid-request",
    httpStatus: 400,
    message: "供应商拒绝了当前请求。",
    phase: "stream",
    providerError: '{"error":{"message":"thinking must be passed back"}}',
    retryable: false,
    version: 1,
  } as const

  it("保留有界供应商错误正文并拒绝异常载荷", () => {
    expect(isTaskRunErrorDataV1(failure)).toBe(true)
    expect(isTaskRunErrorDataV1({ ...failure, providerError: "x".repeat(16_001) })).toBe(false)
    expect(isTaskRunErrorDataV1({ ...failure, providerError: { message: "invalid" } })).toBe(false)
  })
})

const POLICY = {
  limits: { maxOutputTokens: null, maxSteps: 8, timeoutMs: 120_000 },
  mode: "agent",
  reasoning: "auto",
  skillId: "research",
  toolScope: "workspace-read",
  webSearch: true,
} as const satisfies TaskRunPolicy

describe("共享运行策略契约", () => {
  it("接受合法策略及不覆盖输出上限的 null", () => {
    expect(isTaskRunPolicy(POLICY)).toBe(true)
    expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, maxOutputTokens: 4_096 } })).toBe(true)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "拒绝无效 maxSteps：%s",
    (maxSteps) => {
      expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, maxSteps } })).toBe(false)
    },
  )

  it("对所有资源限制使用同一正安全整数边界", () => {
    expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, maxOutputTokens: Number.NaN } })).toBe(
      false,
    )
    expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, timeoutMs: -1 } })).toBe(false)
  })

  it("拒绝损坏的策略字段", () => {
    expect(isTaskRunPolicy({ ...POLICY, mode: "background" })).toBe(false)
    expect(isTaskRunPolicy({ ...POLICY, reasoning: "ultra" })).toBe(false)
    expect(isTaskRunPolicy({ ...POLICY, skillId: "user:Invalid Name" })).toBe(false)
    expect(isTaskRunPolicy({ ...POLICY, toolScope: "filesystem" })).toBe(false)
    expect(isTaskRunPolicy({ ...POLICY, webSearch: "true" })).toBe(false)
  })
})

describe("共享运行资源摘要契约", () => {
  const summary = {
    attachmentCount: 1,
    contextManifest: {
      availableInputTokens: 100_000,
      compaction: {
        estimatedTokensAfter: 12_000,
        estimatedTokensBefore: 24_000,
        firstRetainedMessageIndex: 4,
        omittedMessageCount: 4,
        reason: "threshold",
        retainedMessageCount: 3,
        sourceMessageCount: 7,
        summaryCharacters: 800,
        version: 1,
      },
      estimatedInputTokens: 12_000,
      estimator: "heuristic-v1",
      modelContextWindow: 128_000,
      modelMaxInputTokens: null,
      observedStep: 2,
      reservedOutputTokens: 16_000,
      safetyMarginTokens: 6_000,
      sections: [{ estimatedTokens: 12_000, kind: "conversation" }],
      status: "within-budget",
      version: 1,
    },
    continuedFromMessageId: null,
    currentDocumentPath: "notes/example.md",
    researchNetworkMode: "system",
    resumedResearchRequestId: null,
    workspaceId: "workspace-1",
    workspaceName: "示例工作区",
  }

  it("接受合法摘要并拒绝非法计数与网络模式", () => {
    expect(isTaskRunResourceSummary(summary)).toBe(true)
    expect(isTaskRunResourceSummary({ ...summary, attachmentCount: -1 })).toBe(false)
    expect(isTaskRunResourceSummary({ ...summary, attachmentCount: 1.5 })).toBe(false)
    expect(isTaskRunResourceSummary({ ...summary, researchNetworkMode: "proxy" })).toBe(false)
    expect(
      isTaskRunResourceSummary({
        ...summary,
        contextManifest: { ...summary.contextManifest, status: "guess" },
      }),
    ).toBe(false)
    expect(
      isTaskRunResourceSummary({
        ...summary,
        contextManifest: {
          ...summary.contextManifest,
          compaction: { ...summary.contextManifest.compaction, retainedMessageCount: 2 },
        },
      }),
    ).toBe(false)
  })
})

describe("共享运行策略基础字面量", () => {
  it("只接受规范的用户 Skill ID", () => {
    expect(isUserTaskSkillId("user:meeting-notes")).toBe(true)
    expect(isTaskSkillId("question-answering")).toBe(true)
    expect(isTaskSkillId(null)).toBe(true)
    expect(isUserTaskSkillId("user:")).toBe(false)
    expect(isUserTaskSkillId("user:Meeting Notes")).toBe(false)
  })

  it("只接受冻结的研究网络模式", () => {
    expect(isResearchNetworkMode("system")).toBe(true)
    expect(isResearchNetworkMode("direct")).toBe(true)
    expect(isResearchNetworkMode("proxy")).toBe(false)
  })
})
