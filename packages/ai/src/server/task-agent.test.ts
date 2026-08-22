/**
 * [INPUT]: 含内置/用户 Skill 的类型化 Task Agent call options 与会话/工作区/MCP 工具分组
 * [OUTPUT]: AI SDK 动态配置 Schema、用户 Skill ID 守卫、逐轮工具收窄和原生生命周期指标归一化的回归验证
 * [POS]: 统一 ToolLoopAgent 配置工厂的纯逻辑单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { MockLanguageModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"
import {
  type TaskAgentRunMetrics,
  activeTaskAgentTools,
  createTaskAgent,
  taskAgentCallOptionsSchema,
} from "./task-agent"

const toolNames = ["web-search", "request-user-input", "read-file", "write-file", "mcp-publish"]
const groups = {
  external: ["mcp-publish"],
  workspaceRead: ["read-file"],
  workspaceWrite: ["write-file"],
}

describe("统一 Task Agent 动态配置", () => {
  it("校验完整 RunPolicy call options", () => {
    expect(
      taskAgentCallOptionsSchema.safeParse({
        policy: {
          limits: {
            maxOutputTokens: 4_096,
            maxSteps: 8,
            maxTotalTokens: 80_000,
            timeoutMs: 120_000,
          },
          mode: "agent",
          reasoning: "high",
          skillId: "writing",
          toolScope: "workspace-write",
          webSearch: true,
        },
        skillInstructions: "按当前写作 Skill 执行。",
      }).success,
    ).toBe(true)
  })

  it("接受规范用户 Skill ID 并拒绝路径式伪造 ID", () => {
    const options = {
      policy: {
        limits: {
          maxOutputTokens: 4_096,
          maxSteps: 8,
          maxTotalTokens: 80_000,
          timeoutMs: 120_000,
        },
        mode: "chat",
        reasoning: "high",
        skillId: "user:meeting-notes",
        toolScope: "conversation",
        webSearch: false,
      },
    }

    expect(taskAgentCallOptionsSchema.safeParse(options).success).toBe(true)
    expect(
      taskAgentCallOptionsSchema.safeParse({
        ...options,
        policy: { ...options.policy, skillId: "user:../escape" },
      }).success,
    ).toBe(false)
  })

  it("会话作用域不暴露工作区工具，但保留统一 Agent 的逐次审批 MCP", () => {
    expect(activeTaskAgentTools(toolNames, "conversation", groups)).toEqual([
      "web-search",
      "request-user-input",
      "mcp-publish",
    ])
  })

  it("工作区只读作用域保留读取与逐次审批 MCP，但排除写入", () => {
    expect(activeTaskAgentTools(toolNames, "workspace-read", groups)).toEqual([
      "web-search",
      "request-user-input",
      "read-file",
      "mcp-publish",
    ])
  })

  it("工作区写入作用域保留全部已注册工具，审批仍由工具定义处理", () => {
    expect(activeTaskAgentTools(toolNames, "workspace-write", groups)).toEqual(toolNames)
  })

  it("把端点专属 provider options 与本轮推理强度一起传给模型", async () => {
    const metricSnapshots: TaskAgentRunMetrics[] = []
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    })
    const agent = createTaskAgent({
      model,
      onRunMetrics: (value) => {
        metricSnapshots.push(value)
      },
      providerOptions: { openai: { forceReasoning: true } },
      tools: {},
    })

    await agent.generate({
      prompt: "test",
      options: {
        policy: {
          limits: {
            maxOutputTokens: 4_096,
            maxSteps: 8,
            maxTotalTokens: 80_000,
            timeoutMs: 120_000,
          },
          mode: "agent",
          reasoning: "high",
          skillId: "research",
          toolScope: "conversation",
          webSearch: true,
        },
      },
    })

    expect(model.doGenerateCalls[0]).toMatchObject({
      providerOptions: { openai: { forceReasoning: true } },
      reasoning: "high",
    })
    const metrics = metricSnapshots.at(-1)
    expect(metrics).toMatchObject({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      finishReason: "stop",
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      stepCount: 1,
      timeToFirstOutputMs: null,
      toolCallCount: 0,
      totalTokens: 2,
    })
    expect(metrics?.callId).toEqual(expect.any(String))
    expect(metrics?.modelDurationMs).toBeGreaterThanOrEqual(0)
    expect(metrics?.toolDurationMs).toBe(0)
  })
})
