/**
 * [INPUT]: 同一 Agent 消息内复用 provider reasoning ID 的多步骤 Part
 * [OUTPUT]: 每个消息 Part 都获得稳定且唯一 React key 的回归验证
 * [POS]: chat-message 多步骤流式协调的单元测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { chatMessagePartKey } from "./chat-message"

describe("ChatMessage Part key", () => {
  it("provider 在多个 Agent 步骤复用 reasoning ID 时仍保持唯一", () => {
    const providerReasoningIds = ["reasoning-0", "reasoning-0", "reasoning-0", "reasoning-0"]
    const keys = providerReasoningIds.map((_id, index) => chatMessagePartKey("assistant-1", index))

    expect(new Set(keys).size).toBe(providerReasoningIds.length)
    expect(keys).toEqual([
      "assistant-1-part-0",
      "assistant-1-part-1",
      "assistant-1-part-2",
      "assistant-1-part-3",
    ])
  })
})
