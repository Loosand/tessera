/**
 * [INPUT]: 等待回答、已回答和已发布研究计划的 AI SDK Tool Part
 * [OUTPUT]: 专用问答卡与研究计划卡不会退化为原始 JSON 的渲染回归验证
 * [POS]: user-input-part 与 research-plan-part 的静态呈现单元测试
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ResearchPlanPart, isResearchPlanToolPart, parseResearchPlan } from "./research-plan-part"
import { UserInputPart, isUserInputToolPart, parseTaskUserInputRequest } from "./user-input-part"

const requestInput = {
  title: "确认研究方向",
  description: "这个名称存在多个常见含义。",
  questions: [
    {
      id: "meaning",
      kind: "single",
      prompt: "你指的是哪一个？",
      options: [
        { id: "book", label: "荷马史诗《奥德赛》" },
        { id: "movie", label: "电影改编" },
      ],
      allowCustom: true,
    },
  ],
}

describe("任务交互 Part", () => {
  it("在工具边界过滤未知字段并拒绝不完整的交互结构", () => {
    expect(
      parseTaskUserInputRequest({
        ...requestInput,
        internalState: "不得进入界面",
      }),
    ).toEqual(requestInput)
    expect(
      parseTaskUserInputRequest({
        questions: [{ id: "meaning", kind: "single", prompt: "请选择", options: [] }],
      }),
    ).toBeNull()

    expect(
      parseResearchPlan({
        objective: "验证目标",
        questions: [{ id: "q1", title: "问题一" }],
        internalState: "不得进入界面",
      }),
    ).toEqual({ objective: "验证目标", questions: [{ id: "q1", title: "问题一" }] })
    expect(parseResearchPlan({ objective: "验证目标", questions: [{ id: "q1" }] })).toBeNull()
  })

  it("把待回答工具渲染为可操作问题而不是 JSON", () => {
    const part = {
      type: "tool-request-user-input",
      toolCallId: "question-call",
      state: "input-available",
      input: requestInput,
    } as UIMessage["parts"][number]
    expect(isUserInputToolPart(part)).toBe(true)
    if (!isUserInputToolPart(part)) throw new Error("未识别问答工具。")

    const markup = renderToStaticMarkup(<UserInputPart part={part} onSubmit={() => {}} />)
    expect(markup).toContain("确认研究方向")
    expect(markup).toContain("荷马史诗《奥德赛》")
    expect(markup).toContain("回答后任务会自动继续")
    expect(markup).not.toContain("question-call")
  })

  it("回答后折叠为紧凑确认摘要", () => {
    const part = {
      type: "tool-request-user-input",
      toolCallId: "question-call",
      state: "output-available",
      input: requestInput,
      output: {
        status: "answered",
        answers: [{ questionId: "meaning", optionIds: ["book"] }],
      },
    } as UIMessage["parts"][number]
    if (!isUserInputToolPart(part)) throw new Error("未识别问答工具。")

    const markup = renderToStaticMarkup(<UserInputPart part={part} />)
    expect(markup).toContain("已确认 · 1 项回答")
    expect(markup).toContain("荷马史诗《奥德赛》")
  })

  it("把研究计划渲染为目标和编号问题", () => {
    const part = {
      type: "tool-publish-research-plan",
      toolCallId: "plan-call",
      state: "output-available",
      input: {
        objective: "了解原著与现代改编",
        scope: "原著、音乐剧和电影",
        questions: [
          { id: "q1", title: "原著的核心主题是什么？" },
          { id: "q2", title: "现代改编改变了什么？" },
        ],
      },
      output: { status: "published", questionIds: ["q1", "q2"] },
    } as UIMessage["parts"][number]
    expect(isResearchPlanToolPart(part)).toBe(true)
    if (!isResearchPlanToolPart(part)) throw new Error("未识别研究计划工具。")

    const markup = renderToStaticMarkup(<ResearchPlanPart part={part} streaming={false} />)
    expect(markup).toContain("研究计划")
    expect(markup).toContain("Q1")
    expect(markup).toContain("现代改编改变了什么？")
    expect(markup).not.toContain("plan-call")
  })
})
