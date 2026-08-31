/**
 * [INPUT]: 已读/不可用网页、证据登记与部分完成检查的标准 AI SDK Tool Parts
 * [OUTPUT]: 研究进度来源分层、覆盖数量、部分完成与公共正文隔离的渲染回归验证
 * [POS]: research-activity-part 的纯适配和服务端渲染测试
 * [DOC]: design.md、docs/architecture/research-workflow.md
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
import { ResearchActivityPart, collectResearchActivity } from "./research-activity-part"

type ToolMessagePart = Extract<UIMessage["parts"][number], { type: "dynamic-tool" | `tool-${string}` }>

describe("研究领域进度", () => {
  it("区分已阅读、不可用、证据与问题覆盖，并呈现部分完成", () => {
    const parts = [
      {
        type: "tool-read-web-source",
        toolCallId: "read-1",
        state: "output-available",
        input: { url: "https://example.com/interview", questionIds: ["q1"] },
        output: {
          sourceId: "source-1",
          status: "read",
          finalUrl: "https://example.com/interview",
          title: "FKJ Interview",
          charCount: 2_000,
          truncated: false,
        },
      },
      {
        type: "tool-read-web-source",
        toolCallId: "read-2",
        state: "output-available",
        input: { url: "https://example.com/paywall", questionIds: ["q2"] },
        output: {
          sourceId: "source-2",
          status: "unusable",
          finalUrl: "https://example.com/paywall",
          charCount: 0,
          truncated: false,
          error: "页面需要登录",
        },
      },
      {
        type: "tool-record-research-evidence",
        toolCallId: "evidence-1",
        state: "output-available",
        input: { questionId: "q1", sourceId: "source-1", claim: "现场循环", excerpt: "原文" },
        output: { status: "recorded", evidenceId: "evidence-1" },
      },
      {
        type: "tool-read-web-source",
        toolCallId: "read-sdk-error",
        state: "output-error",
        input: { url: "https://example.com/not-a-real-attempt", questionIds: ["q2"] },
        errorText: "AI_NoSuchToolError",
      },
      {
        type: "tool-finalize-research",
        toolCallId: "finalize-1",
        state: "output-available",
        input: { outcome: "partial", questions: [], limitations: ["登录墙"] },
        output: {
          status: "partial",
          progress: {
            phase: "completed",
            planPublished: true,
            outcome: "partial",
            questionCounts: { pending: 0, covered: 1, partial: 0, uncovered: 1 },
            sourceCounts: { discovered: 3, shortlisted: 0, reading: 0, read: 1, unusable: 1 },
            evidenceCount: 1,
          },
        },
      },
    ] as ToolMessagePart[]

    expect(collectResearchActivity(parts)).toMatchObject({
      readCount: 1,
      unusableCount: 1,
      evidenceCount: 1,
      finalizeStatus: "partial",
      questionCounts: { covered: 1, uncovered: 1 },
      sourceCounts: { discovered: 3, read: 1, unusable: 1 },
    })
    const markup = renderToStaticMarkup(<ResearchActivityPart parts={parts} streaming={false} />)
    expect(markup).toContain("研究进度")
    expect(markup).toContain("部分完成")
    expect(markup).toContain(
      "已发现 5 个来源 · 已阅读 1 个来源 · 1 个不可用 · 已登记 1 条证据 · 覆盖 1/2 个问题",
    )
    expect(markup).toContain("FKJ Interview")
    expect(markup).toContain("不可用")
    expect(markup).toContain("页面需要登录")
    expect(markup).not.toContain("not-a-real-attempt")
    expect(markup).not.toContain("source-1")
  })
})
