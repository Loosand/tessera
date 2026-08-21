/**
 * [INPUT]: AI SDK UI 工具增量与 Tessera 公开流式协议
 * [OUTPUT]: 工具输入、结果和错误字段不丢失的公开增量映射回归验证
 * [POS]: Chat/Agent 共用 UIMessageChunk 裁剪边界的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { publicChunk } from "./chat-runtime"

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
