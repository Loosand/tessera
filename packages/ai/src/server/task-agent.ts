/**
 * [INPUT]: 已解析 TaskRunPolicy、AI SDK LanguageModel、当前请求工具集合、领域 instructions、Telemetry、生命周期观测回调与工具分组
 * [OUTPUT]: 通过 callOptionsSchema/prepareCall 动态收窄推理、工具、预算和 Skill instructions，并以 AI SDK 原生生命周期产出统一运行指标的 ToolLoopAgent
 * [POS]: 无工作区对话与工作区 Agent 共用的 AI SDK 标准动态配置工厂
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type TaskRunPolicy,
  type TaskToolScope,
  type UserTaskSkillId,
  isUserTaskSkillId,
} from "@tessera/contracts"
import {
  type GenerateTextEndEvent,
  type GenerateTextStepEndEvent,
  type JSONValue,
  type LanguageModel,
  ToolLoopAgent,
  type ToolSet,
  isStepCount,
} from "ai"
import { z } from "zod"

const taskRunPolicySchema = z.strictObject({
  limits: z.strictObject({
    maxOutputTokens: z.number().int().positive(),
    maxSteps: z.number().int().positive(),
    maxTotalTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
  }),
  mode: z.enum(["chat", "agent"]),
  reasoning: z.enum(["auto", "none", "low", "medium", "high"]),
  skillId: z
    .union([
      z.enum(["research", "writing", "question-answering"]),
      z.custom<UserTaskSkillId>(isUserTaskSkillId, "用户 Skill ID 无效"),
    ])
    .nullable(),
  toolScope: z.enum(["conversation", "workspace-read", "workspace-write"]),
  webSearch: z.boolean(),
}) satisfies z.ZodType<TaskRunPolicy>

export const taskAgentCallOptionsSchema = z.strictObject({
  policy: taskRunPolicySchema,
  skillInstructions: z.string().max(160_000).optional(),
})

export type TaskAgentCallOptions = z.infer<typeof taskAgentCallOptionsSchema>

export type TaskAgentToolGroups = Readonly<{
  external?: readonly string[]
  workspaceRead?: readonly string[]
  workspaceWrite?: readonly string[]
}>

export type TaskAgentRunMetrics = Readonly<{
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  callId: string
  finishReason: string | null
  inputTokens: number | null
  modelDurationMs: number
  outputTokens: number | null
  rawFinishReason: string | null
  reasoningTokens: number | null
  stepCount: number
  timeToFirstOutputMs: number | null
  toolCallCount: number
  toolDurationMs: number
  totalTokens: number | null
}>

function sumKnown(values: readonly (number | undefined)[]) {
  const known = values.filter((value): value is number => value !== undefined)
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null
}

function metricsFromSteps(
  steps: readonly GenerateTextStepEndEvent<ToolSet>[],
  options: Readonly<{
    callId: string
    finishReason?: string | undefined
    rawFinishReason?: string | undefined
  }>,
): TaskAgentRunMetrics {
  return {
    cacheReadTokens: sumKnown(steps.map((step) => step.usage.inputTokenDetails.cacheReadTokens)),
    cacheWriteTokens: sumKnown(steps.map((step) => step.usage.inputTokenDetails.cacheWriteTokens)),
    callId: options.callId,
    finishReason: options.finishReason ?? null,
    inputTokens: sumKnown(steps.map((step) => step.usage.inputTokens)),
    modelDurationMs: steps.reduce((total, step) => total + step.performance.responseTimeMs, 0),
    outputTokens: sumKnown(steps.map((step) => step.usage.outputTokens)),
    rawFinishReason: options.rawFinishReason ?? null,
    reasoningTokens: sumKnown(steps.map((step) => step.usage.outputTokenDetails.reasoningTokens)),
    stepCount: steps.length,
    timeToFirstOutputMs: steps[0]?.performance.timeToFirstOutputMs ?? null,
    toolCallCount: steps.reduce((total, step) => total + step.toolCalls.length, 0),
    toolDurationMs: steps.reduce(
      (total, step) =>
        total + Object.values(step.performance.toolExecutionMs).reduce((sum, value) => sum + value, 0),
      0,
    ),
    totalTokens: sumKnown(steps.map((step) => step.usage.totalTokens)),
  }
}

export function taskAgentRunMetrics(event: GenerateTextEndEvent<ToolSet>): TaskAgentRunMetrics {
  const metrics = metricsFromSteps(event.steps, {
    callId: event.callId,
    finishReason: event.finishReason,
    rawFinishReason: event.rawFinishReason,
  })
  return {
    ...metrics,
    cacheReadTokens: event.usage.inputTokenDetails.cacheReadTokens ?? null,
    cacheWriteTokens: event.usage.inputTokenDetails.cacheWriteTokens ?? null,
    inputTokens: event.usage.inputTokens ?? null,
    outputTokens: event.usage.outputTokens ?? null,
    reasoningTokens: event.usage.outputTokenDetails.reasoningTokens ?? null,
    totalTokens: event.usage.totalTokens ?? null,
  }
}

function excludedToolNames(scope: TaskToolScope, groups: TaskAgentToolGroups) {
  if (scope === "workspace-write") return new Set<string>()
  const excluded = new Set(groups.workspaceWrite ?? [])
  if (scope === "conversation") {
    for (const name of groups.workspaceRead ?? []) excluded.add(name)
  }
  return excluded
}

export function activeTaskAgentTools(
  toolNames: readonly string[],
  scope: TaskToolScope,
  groups: TaskAgentToolGroups = {},
) {
  const excluded = excludedToolNames(scope, groups)
  return toolNames.filter((name) => !excluded.has(name))
}

export function reasoningLevel(reasoning: TaskRunPolicy["reasoning"]) {
  return reasoning === "auto" ? "provider-default" : reasoning
}

function combinedInstructions(baseInstructions: string | undefined, skillInstructions: string | undefined) {
  const sections = [baseInstructions?.trim(), skillInstructions?.trim()].filter(Boolean)
  return sections.length > 0 ? sections.join("\n\n") : undefined
}

export function createTaskAgent({
  baseInstructions,
  model,
  onRunMetrics,
  providerOptions,
  toolGroups = {},
  tools,
}: {
  baseInstructions?: string
  model: LanguageModel
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  providerOptions?: Record<string, Record<string, JSONValue>>
  toolGroups?: TaskAgentToolGroups
  tools: ToolSet
}) {
  const toolNames = Object.keys(tools)
  const completedSteps: GenerateTextStepEndEvent<ToolSet>[] = []
  return new ToolLoopAgent<TaskAgentCallOptions, ToolSet>({
    id: "tessera-task-agent",
    model,
    ...(providerOptions ? { providerOptions } : {}),
    tools,
    telemetry: {
      functionId: "tessera.task-agent",
    },
    onStepEnd: (event) => {
      completedSteps.push(event)
      onRunMetrics?.(metricsFromSteps(completedSteps, { callId: event.callId }))
    },
    onEnd: (event) => onRunMetrics?.(taskAgentRunMetrics(event)),
    ...(baseInstructions ? { instructions: baseInstructions } : {}),
    callOptionsSchema: taskAgentCallOptionsSchema,
    prepareCall: ({ options, ...settings }) => {
      const instructions = combinedInstructions(baseInstructions, options.skillInstructions)
      return {
        ...settings,
        activeTools: activeTaskAgentTools(toolNames, options.policy.toolScope, toolGroups),
        ...(instructions ? { instructions } : {}),
        maxOutputTokens: options.policy.limits.maxOutputTokens,
        reasoning: reasoningLevel(options.policy.reasoning),
        stopWhen: [
          isStepCount(options.policy.limits.maxSteps),
          ({ steps }) =>
            steps.reduce((total, step) => total + (step.usage.totalTokens ?? 0), 0) >=
            options.policy.limits.maxTotalTokens,
        ],
      }
    },
  })
}
