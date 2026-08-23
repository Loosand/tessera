/**
 * [INPUT]: 自动、研究、写作、问答创作方式与官方/自定义模型连接
 * [OUTPUT]: 受信任 RunPolicy 对联网、推理、工具作用域、端点回落和安全护栏的回归验证
 * [POS]: 统一创作 Agent 每轮策略解析器的单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderModel } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { resolveTaskRunPolicy } from "./run-policy"

function model(id: string): AiProviderModel {
  return {
    contextWindow: null,
    id,
    maxOutputTokens: null,
    name: null,
    ownedBy: null,
  }
}

describe("统一任务 RunPolicy", () => {
  it("研究模式固定选择深度推理与原生联网", () => {
    expect(
      resolveTaskRunPolicy({
        baseUrl: "https://api.deepseek.com",
        mode: "agent",
        model: model("deepseek-v4-pro"),
        providerId: "deepseek",
        skillId: "research",
      }),
    ).toMatchObject({
      execution: { endpointType: "anthropic-messages" },
      issues: [],
      policy: {
        reasoning: "high",
        toolScope: "workspace-write",
        webSearch: true,
        limits: { maxOutputTokens: null, maxSteps: 32, timeoutMs: 1_800_000 },
      },
    })
  })

  it("按模型上下文窗口放宽研究循环保险丝，并透传模型原生输出上限", () => {
    expect(
      resolveTaskRunPolicy({
        baseUrl: "https://api.deepseek.com",
        mode: "chat",
        model: { ...model("deepseek-v4-pro"), contextWindow: 1_048_576, maxOutputTokens: 393_216 },
        providerId: "deepseek",
        skillId: "research",
      }).policy.limits,
    ).toEqual({ maxOutputTokens: 393_216, maxSteps: 64, timeoutMs: 1_800_000 })
  })

  it("问答模式关闭联网并收窄到工作区只读工具", () => {
    expect(
      resolveTaskRunPolicy({
        baseUrl: "https://api.deepseek.com",
        mode: "agent",
        model: model("deepseek-v4-pro"),
        providerId: "deepseek",
        skillId: "question-answering",
      }).policy,
    ).toMatchObject({ reasoning: "auto", toolScope: "workspace-read", webSearch: false })
  })

  it("自动模式在自定义代理没有搜索能力时回落到普通端点", () => {
    const result = resolveTaskRunPolicy({
      baseUrl: "https://relay.example.com/v1",
      mode: "chat",
      model: model("deepseek-v4-pro"),
      providerId: "deepseek",
      skillId: null,
    })

    expect(result).toMatchObject({
      execution: { endpointType: "openai-chat-completions" },
      issues: [],
      policy: { toolScope: "conversation", webSearch: false },
    })
  })
})
