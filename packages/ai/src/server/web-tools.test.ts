/**
 * [INPUT]: 无状态 WebAgentTools 假实现、公开 URL 与网页正文工具结果
 * [OUTPUT]: 单一网页深读工具注册、Schema 边界和公共历史正文裁剪回归验证
 * [POS]: 可选 Web capability AI SDK 适配层的单元测试
 * [DOC]: docs/architecture/agent-simplification-roadmap.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  READ_WEB_SOURCE_TOOL_NAME,
  createWebToolSet,
  publicWebToolOutput,
  webSourceReadInputSchema,
} from "./web-tools"

describe("可选 Web capability", () => {
  it("只注册无状态网页深读工具", () => {
    const tools = createWebToolSet(
      {
        readSource: async ({ url }) => ({
          charCount: 4,
          content: "正文",
          contentHash: "hash",
          contentType: "text/html",
          finalUrl: url,
          truncated: false,
        }),
      },
      new AbortController().signal,
    )

    expect(Object.keys(tools)).toEqual([READ_WEB_SOURCE_TOOL_NAME])
  })

  it("拒绝非 http(s) 地址", () => {
    expect(webSourceReadInputSchema.safeParse({ url: "https://example.com/article" }).success).toBe(true)
    expect(webSourceReadInputSchema.safeParse({ url: "file:///etc/passwd" }).success).toBe(false)
  })

  it("正文只供当前模型使用，不进入公开 Tool Part", () => {
    expect(
      publicWebToolOutput(READ_WEB_SOURCE_TOOL_NAME, {
        finalUrl: "https://example.com/article",
        title: "Example",
        content: "不应持久化的长正文",
      }),
    ).toEqual({ finalUrl: "https://example.com/article", title: "Example" })
  })
})
