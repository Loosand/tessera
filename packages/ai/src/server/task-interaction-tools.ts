/**
 * [INPUT]: 当前任务 Skill 与模型对澄清问题、研究计划的结构化调用
 * [OUTPUT]: 可由客户端回答的 request-user-input 工具，以及无副作用的 publish-research-plan 工具
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
    .max(3),
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
    "当用户请求存在会显著改变结果的歧义或缺少必要选择时，暂停任务并向用户提出 1 到 3 个简短问题。不要用它替代可以安全推断的小细节。",
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

export function createTaskInteractionTools(skillId: TaskSkillId) {
  return skillId === "research"
    ? {
        [REQUEST_USER_INPUT_TOOL_NAME]: requestUserInputTool,
        [PUBLISH_RESEARCH_PLAN_TOOL_NAME]: publishResearchPlanTool,
      }
    : { [REQUEST_USER_INPUT_TOOL_NAME]: requestUserInputTool }
}
