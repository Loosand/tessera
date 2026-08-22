/**
 * [INPUT]: 模拟主进程研究服务、网页读取工具结果与 AI SDK 工具定义
 * [OUTPUT]: 研究工具窄契约、正文仅供模型当前步骤使用以及公共消息裁剪的回归验证
 * [POS]: research-tools 的协议与秘密/体积边界单元测试
 * [DOC]: docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it, vi } from "vitest"
import { createResearchToolSet, publicResearchToolOutput } from "./research-tools"

const progress = {
  phase: "reading" as const,
  planPublished: true,
  outcome: null,
  questionCounts: { pending: 1, covered: 0, partial: 0, uncovered: 0 },
  sourceCounts: { discovered: 0, shortlisted: 0, reading: 0, read: 1, unusable: 0 },
  evidenceCount: 0,
}

describe("研究领域工具", () => {
  it("注册完整研究工具，但网页正文不会进入公共消息事件", async () => {
    const readSource = vi.fn(async () => ({
      sourceId: "source-1",
      status: "read" as const,
      finalUrl: "https://example.com/interview",
      title: "Interview",
      charCount: 35,
      truncated: false,
      contentHash: "sha256:abc",
      content: "[p1] This is the complete source body.",
    }))
    const controller = createResearchToolSet(
      {
        getProgress: () => progress,
        publishPlan: vi.fn(),
        readSource,
        recordEvidence: vi.fn(),
        finalize: vi.fn(),
      },
      new AbortController().signal,
    )
    expect(Object.keys(controller.tools)).toEqual([
      "publish-research-plan",
      "read-web-source",
      "record-research-evidence",
      "finalize-research",
    ])
    const output = await readSource()
    expect(publicResearchToolOutput("read-web-source", output)).toEqual({
      sourceId: "source-1",
      status: "read",
      finalUrl: "https://example.com/interview",
      title: "Interview",
      charCount: 35,
      truncated: false,
      contentHash: "sha256:abc",
    })
  })
})
