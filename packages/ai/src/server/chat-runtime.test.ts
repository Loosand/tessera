/**
 * [INPUT]: AI SDK UI 工具增量、供应商错误与 Tessera 公开流式协议
 * [OUTPUT]: 工具增量裁剪、错误归类脱敏和 Skill 搜索额度策略的回归验证
 * [POS]: Chat/Agent 共用 UIMessageChunk 裁剪边界的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { publicChunk, safeErrorMessage, webSearchMaxUsesForSkill } from "./chat-runtime"

describe("Agent 工具公开增量", () => {
  it("保留工具名、相对路径输入与结构化输出", () => {
    expect(
      publicChunk({
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "read-workspace-file",
        input: { path: "README.md" },
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "read-workspace-file",
      input: { path: "README.md" },
    })
    expect(
      publicChunk({
        type: "tool-output-available",
        toolCallId: "call-1",
        output: { path: "README.md", content: "# Tessera" },
      }),
    ).toEqual({
      type: "tool-output-available",
      toolCallId: "call-1",
      output: { path: "README.md", content: "# Tessera" },
    })
  })
})

describe("Chat 运行时边界", () => {
  it("把搜索次数耗尽和协议校验失败映射为可操作文案", () => {
    expect(safeErrorMessage(new Error("error_code: max_uses_exceeded"), "secret")).toContain(
      "达到本轮次数上限",
    )
    expect(
      safeErrorMessage(
        new Error("Type validation failed: web_search_tool_result invalid_union secret"),
        "secret",
      ),
    ).toBe("联网搜索服务返回了不兼容的结果格式，请稍后重试或暂时关闭联网搜索。")
  })

  it("隐藏 API Key 与 Authorization Header", () => {
    const message = safeErrorMessage(
      new Error("request failed api-key=secret-key Authorization: Bearer-token"),
      "secret-key",
    )
    expect(message).not.toContain("secret-key")
    expect(message).not.toContain("Bearer-token")
    expect(message).toContain("Authorization: [已隐藏]")
  })

  it("仅为研究 Skill 提升有界搜索额度", () => {
    expect(webSearchMaxUsesForSkill("research")).toBe(15)
    expect(webSearchMaxUsesForSkill("writing")).toBe(5)
    expect(webSearchMaxUsesForSkill(null)).toBe(5)
  })
})
