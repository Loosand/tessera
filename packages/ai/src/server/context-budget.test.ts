/**
 * [INPUT]: 中英文上下文、模型输入/输出上限、工具结果与活动工具名
 * [OUTPUT]: ContextManifest 确定性估算、分项和超预算前置错误回归
 * [POS]: context-budget 的纯逻辑单元测试
 * [DOC]: docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  ContextBudgetExceededError,
  assertTaskContextBudget,
  createTaskContextManifest,
  estimateTextTokens,
} from "./context-budget"

describe("ContextManifest", () => {
  it("区分 ASCII 与 CJK，并为工具结果单独记账", () => {
    expect(estimateTextTokens("abcd")).toBe(1)
    expect(estimateTextTokens("研究")).toBe(2)

    const manifest = createTaskContextManifest({
      activeToolNames: ["web_search", "read-web-source"],
      instructions: "请核查来源",
      limits: { contextWindow: 128_000, maxInputTokens: null, maxOutputTokens: 16_000 },
      messages: [
        { role: "user", content: "比较两个项目" },
        { role: "tool", content: [{ type: "tool-result", output: "证据正文" }] },
      ],
      observedStep: 2,
      policyMaxOutputTokens: null,
    })

    expect(manifest.status).toBe("within-budget")
    expect(manifest.availableInputTokens).toBeLessThan(112_000)
    expect(manifest.sections.find((section) => section.kind === "tool-results")?.estimatedTokens).toBe(20)
    expect(manifest.observedStep).toBe(2)
  })

  it("在模型调用前拒绝明显超过安全预算的上下文", () => {
    const manifest = createTaskContextManifest({
      activeToolNames: [],
      instructions: "规则",
      limits: { contextWindow: 4_096, maxInputTokens: 3_000, maxOutputTokens: 1_024 },
      messages: [{ role: "user", content: "证".repeat(4_000) }],
      observedStep: 0,
      policyMaxOutputTokens: 1_024,
    })

    expect(manifest.status).toBe("over-budget")
    expect(() => assertTaskContextBudget(manifest)).toThrow(ContextBudgetExceededError)
  })

  it("模型没有声明上下文上限时只做审计，不阻断运行", () => {
    const manifest = createTaskContextManifest({
      activeToolNames: [],
      instructions: "规则",
      limits: { contextWindow: null, maxInputTokens: null, maxOutputTokens: null },
      messages: [{ role: "user", content: "继续" }],
      observedStep: 0,
      policyMaxOutputTokens: null,
    })

    expect(manifest.status).toBe("unknown")
    expect(() => assertTaskContextBudget(manifest)).not.toThrow()
  })
})
