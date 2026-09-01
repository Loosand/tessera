/**
 * [INPUT]: 模型对核心语义澄清的结构化调用与当前任务消息
 * [OUTPUT]: 仅用于核心语义消歧且每个用户请求最多出现一次的 request-user-input 工具
 * [POS]: 所有 ToolLoopAgent 路径共用的最小人机暂停工具
 * [DOC]: docs/architecture/agent-simplification-roadmap.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { REQUEST_USER_INPUT_TOOL_NAME, type TaskMessage } from "@tessera/contracts"
import { tool } from "ai"
import { z } from "zod"

const optionSchema = z.strictObject({
  id: z.string().min(1).max(80).describe("在这道问题内稳定且唯一的选项 ID"),
  label: z.string().min(1).max(160).describe("呈现给用户的简短选项文本"),
  description: z.string().max(320).optional().describe("可选的补充说明或选择影响"),
})

const choiceQuestionFields = {
  id: z.string().min(1).max(80).describe("在本次请求中稳定且唯一的问题 ID"),
  prompt: z.string().min(1).max(500).describe("需要用户回答的问题"),
  options: z.array(optionSchema).min(2).max(8),
  required: z.boolean().optional().describe("是否必须回答，默认是 true"),
  allowCustom: z.boolean().optional().describe("是否允许用户补充自定义答案"),
}

export const taskUserInputRequestSchema = z.strictObject({
  title: z.string().min(1).max(160).optional().describe("整组问题的简短标题"),
  description: z.string().max(500).optional().describe("为什么需要这些信息"),
  questions: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("single"), ...choiceQuestionFields }),
        z.strictObject({ kind: z.literal("multiple"), ...choiceQuestionFields }),
        z.strictObject({
          kind: z.literal("text"),
          id: z.string().min(1).max(80).describe("在本次请求中稳定且唯一的问题 ID"),
          prompt: z.string().min(1).max(500).describe("需要用户回答的问题"),
          required: z.boolean().optional().describe("是否必须回答，默认是 true"),
        }),
      ]),
    )
    .min(1)
    .max(1),
})

export const taskUserInputResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("answered"),
    answers: z
      .array(
        z.strictObject({
          questionId: z.string().min(1).max(80),
          optionIds: z.array(z.string().min(1).max(80)).max(8).optional(),
          text: z.string().max(2_000).optional(),
        }),
      )
      .min(1)
      .max(3),
  }),
  z.strictObject({ status: z.literal("skipped") }),
  z.strictObject({ status: z.literal("dismissed") }),
])

export const requestUserInputTool = tool({
  description:
    "极少使用的核心语义消歧工具。只有当用户请求存在多个互斥且同样合理的核心指代或目标、上下文无法判断、任意猜测都会让答案答非所问时，才暂停并询问一个决定方向的问题；例如“什么是奥德赛”可能指荷马史诗、电影、游戏或其他作品。不得为了平台、篇幅、风格、语气、受众、文章角度、输出格式、资料范围、个性化或提高质量而询问，这些细节必须采用合理默认值并直接完成。只要能产出有用答案就不要调用；每个用户请求最多调用一次。",
  inputSchema: taskUserInputRequestSchema,
  outputSchema: taskUserInputResultSchema,
})

type TaskInteractionToolOptions = {
  readonly allowUserInput?: boolean
}

function messagePartToolName(part: TaskMessage["parts"][number]) {
  if (part.type === "dynamic-tool") return part.toolName
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null
}

export function hasRequestedUserInputSinceLastUserMessage(messages: readonly TaskMessage[]) {
  let lastUserMessageIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserMessageIndex = index
      break
    }
  }
  return messages
    .slice(lastUserMessageIndex + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.parts.some((part) => messagePartToolName(part) === REQUEST_USER_INPUT_TOOL_NAME),
    )
}

export function createTaskInteractionTools({ allowUserInput = true }: TaskInteractionToolOptions = {}) {
  return {
    ...(allowUserInput ? { [REQUEST_USER_INPUT_TOOL_NAME]: requestUserInputTool } : {}),
  }
}
