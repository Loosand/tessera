/**
 * [INPUT]: AI SDK MockLanguageModelV4 的结构化引申问题输出与主运行指标
 * [OUTPUT]: 问题清洗/去重、短调用参数和聚合指标的确定性回归验证
 * [POS]: follow-up-questions 非关键后处理边界的单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { MockLanguageModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"
import { generateFollowUpQuestions, mergeFollowUpRunMetrics } from "./follow-up-questions"

describe("回答后的引申问题", () => {
  it("使用结构化短调用生成并去重可直接发送的问题", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              questions: [
                { prompt: "- 哪些一手来源最能验证这一结论？" },
                { prompt: "这一结论在最近两年发生了哪些变化？" },
                { prompt: "哪些一手来源最能验证这一结论？" },
              ],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 20, noCache: 18, cacheRead: 2, cacheWrite: 0 },
          outputTokens: { total: 12, text: 12, reasoning: 0 },
        },
        warnings: [],
      },
    })

    const result = await generateFollowUpQuestions({
      abortSignal: new AbortController().signal,
      answer: "这是已经完成并带有来源的回答。",
      model,
      skillId: "research",
      userRequest: "请研究这个主题。",
    })

    expect(result?.data).toEqual({
      version: 1,
      questions: [
        { id: "follow-up-1", prompt: "哪些一手来源最能验证这一结论？" },
        { id: "follow-up-2", prompt: "这一结论在最近两年发生了哪些变化？" },
      ],
    })
    expect(model.doGenerateCalls[0]).toMatchObject({
      maxOutputTokens: 768,
      reasoning: "none",
      responseFormat: { type: "json" },
    })
    expect(result?.metrics).toMatchObject({
      cacheReadTokens: 2,
      inputTokens: 20,
      outputTokens: 12,
      reasoningTokens: 0,
      stepCount: 1,
      totalTokens: 32,
    })
  })

  it("有效问题不足时省略 Data Part，但仍保留已消耗的后处理用量", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              questions: [{ prompt: "同一个问题？" }, { prompt: "- 同一个问题？" }],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      },
    })

    const result = await generateFollowUpQuestions({
      abortSignal: new AbortController().signal,
      answer: "已完成回答。",
      model,
      skillId: null,
      userRequest: "请解释。",
    })

    expect(result?.data).toBeNull()
    expect(result?.metrics.totalTokens).toBe(15)
  })

  it("把后处理用量并入同一 task run，而不改变主调用身份和工具数", () => {
    const merged = mergeFollowUpRunMetrics(
      {
        cacheReadTokens: 3,
        cacheWriteTokens: 1,
        callId: "main-call",
        finishReason: "stop",
        inputTokens: 100,
        modelDurationMs: 40,
        outputTokens: 30,
        rawFinishReason: "stop",
        reasoningTokens: 5,
        stepCount: 2,
        timeToFirstOutputMs: 10,
        toolCallCount: 4,
        toolDurationMs: 20,
        totalTokens: 130,
      },
      {
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
        inputTokens: 20,
        modelDurationMs: 8,
        outputTokens: 12,
        reasoningTokens: 0,
        stepCount: 1,
        totalTokens: 32,
      },
    )

    expect(merged).toMatchObject({
      callId: "main-call",
      cacheReadTokens: 5,
      inputTokens: 120,
      outputTokens: 42,
      stepCount: 3,
      toolCallCount: 4,
      totalTokens: 162,
    })
  })
})
