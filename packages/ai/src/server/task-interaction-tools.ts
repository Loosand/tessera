/**
 * [INPUT]: 当前任务 Skill 与模型对澄清问题、研究计划的结构化调用
 * [OUTPUT]: 仅用于核心语义消歧且每个用户请求最多出现一次的 request-user-input 工具，以及无副作用的 publish-research-plan 工具
 * [POS]: Chat streamText 与 ToolLoopAgent 共用的人机交互和研究展示工具集合
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  PUBLISH_RESEARCH_PLAN_TOOL_NAME,
  REQUEST_USER_INPUT_TOOL_NAME,
  type TaskMessage,
  type TaskSkillId,
} from "@tessera/contracts"
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

export const taskResearchPlanInputSchema = z.strictObject({
  objective: z.string().min(1).max(1_000).describe("本次研究要回答的核心目标"),
  scope: z.string().max(1_000).optional().describe("研究边界、时间范围或排除项"),
  deliverable: z.string().max(500).optional().describe("最终交付物的形式和重点"),
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(80).describe("稳定且唯一的问题 ID，例如 q1"),
        title: z.string().min(1).max(500).describe("需要在研究中回答的子问题"),
      }),
    )
    .min(1)
    .max(8),
})

export const taskResearchPlanOutputSchema = z.strictObject({
  status: z.literal("published"),
  questionIds: z.array(z.string().min(1).max(80)).min(1).max(8),
})

export const requestUserInputTool = tool({
  description:
    "极少使用的核心语义消歧工具。只有当用户请求存在多个互斥且同样合理的核心指代或目标、上下文无法判断、任意猜测都会让答案答非所问时，才暂停并询问一个决定方向的问题；例如“什么是奥德赛”可能指荷马史诗、电影、游戏或其他作品。不得为了平台、篇幅、风格、语气、受众、文章角度、输出格式、资料范围、个性化或提高质量而询问，这些细节必须采用合理默认值并直接完成。只要能产出有用答案就不要调用；每个用户请求最多调用一次。",
  inputSchema: taskUserInputRequestSchema,
  outputSchema: taskUserInputResultSchema,
})

export const publishResearchPlanTool = tool({
  description:
    "在开始多步骤研究前发布结构化研究计划，让用户看到目标、范围和子问题。只在 research Skill 中调用；澄清完成后通常只调用一次。",
  inputSchema: taskResearchPlanInputSchema,
  outputSchema: taskResearchPlanOutputSchema,
  execute: ({ questions }) => ({
    status: "published" as const,
    questionIds: questions.map((question) => question.id),
  }),
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

export function createTaskInteractionTools(
  skillId: TaskSkillId,
  { allowUserInput = true }: TaskInteractionToolOptions = {},
) {
  return {
    ...(allowUserInput ? { [REQUEST_USER_INPUT_TOOL_NAME]: requestUserInputTool } : {}),
    ...(skillId === "research" ? { [PUBLISH_RESEARCH_PLAN_TOOL_NAME]: publishResearchPlanTool } : {}),
  }
}
