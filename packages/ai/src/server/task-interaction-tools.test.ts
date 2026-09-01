/**
 * [INPUT]: 客户端问答的合法与非法结构、用户请求消息边界
 * [OUTPUT]: 单问题 Schema、无执行暂停语义和每请求一次限制的回归验证
 * [POS]: task-interaction-tools 的协议单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskMessage } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import {
  createTaskInteractionTools,
  hasRequestedUserInputSinceLastUserMessage,
  requestUserInputTool,
  taskUserInputRequestSchema,
} from "./task-interaction-tools"

describe("任务交互工具", () => {
  it("用无 execute 的客户端工具暂停并等待类型化回答", () => {
    expect(requestUserInputTool.execute).toBeUndefined()
    expect(requestUserInputTool.description).toContain("什么是奥德赛")
    expect(
      taskUserInputRequestSchema.safeParse({
        title: "确认研究方向",
        questions: [
          {
            id: "meaning",
            kind: "single",
            prompt: "你指的是哪一个？",
            options: [
              { id: "book", label: "原著" },
              { id: "movie", label: "电影" },
            ],
            allowCustom: true,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      taskUserInputRequestSchema.safeParse({
        questions: [{ id: "broken", kind: "single", prompt: "不完整", options: [] }],
      }).success,
    ).toBe(false)
    expect(
      taskUserInputRequestSchema.safeParse({
        questions: [
          { id: "platform", kind: "text", prompt: "发布到哪里？" },
          { id: "tone", kind: "text", prompt: "希望什么语气？" },
        ],
      }).success,
    ).toBe(false)
  })

  it("只暴露最小澄清工具", () => {
    expect(Object.keys(createTaskInteractionTools())).toEqual(["request-user-input"])
    expect(Object.keys(createTaskInteractionTools({ allowUserInput: false }))).toEqual([])
  })

  it("同一个用户请求询问一次后不再暴露问答工具", () => {
    const messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "什么是奥德赛？" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-request-user-input",
            toolCallId: "call-1",
            state: "output-available",
            input: {},
            output: { status: "answered" },
          },
        ],
      },
    ] satisfies TaskMessage[]

    expect(hasRequestedUserInputSinceLastUserMessage(messages)).toBe(true)
    expect(
      hasRequestedUserInputSinceLastUserMessage([
        ...messages,
        { id: "user-2", role: "user", parts: [{ type: "text", text: "继续" }] },
      ]),
    ).toBe(false)
  })
})
