/**
 * [INPUT]: 已解析 TaskRunPolicy、模型上下文上限、AI SDK LanguageModel、当前请求工具集合、Skill instructions、Provider options、生命周期/ContextManifest 观测回调与工具分组
 * [OUTPUT]: 保留具体 ToolSet 类型、动态收窄推理/工具/Skill、明确 Provider retry、工具源序结果、确定性上下文压缩与预算检查，并以 AI SDK 原生生命周期产出统一指标的 ToolLoopAgent
 * [POS]: 无工作区对话与工作区 Agent 共用的 AI SDK 标准动态配置工厂
 * [DOC]: docs/architecture/agent-simplification-roadmap.md、docs/architecture/agent-run-reliability.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskContextManifest, TaskRunPolicy, TaskToolScope, UserTaskSkillId } from "@tessera/contracts"
import { isUserTaskSkillId } from "@tessera/contracts"
import {
  type GenerateTextEndEvent,
  type GenerateTextStepEndEvent,
  type JSONValue,
  type LanguageModel,
  NoSuchToolError,
  type ToolCallRepairFunction,
  ToolLoopAgent,
  type ToolSet,
  generateText,
  isStepCount,
} from "ai"
import { z } from "zod"
import {
  type TaskModelContextLimits,
  assertTaskContextBudget,
  createTaskContextManifest,
} from "./context-budget"
import { canonicalizeToolResultOrder, compactTaskModelMessages } from "./context-compaction"

const taskRunPolicySchema = z.strictObject({
  limits: z.strictObject({
    maxOutputTokens: z.number().int().positive().nullable(),
    maxSteps: z.number().int().positive(),
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

const TASK_PROVIDER_MAX_RETRIES = 2

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

function metricsFromSteps<TOOLS extends ToolSet>(
  steps: readonly GenerateTextStepEndEvent<TOOLS>[],
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

export function createTaskToolCallRepair<TOOLS extends ToolSet>(
  model: LanguageModel,
  providerOptions?: Record<string, Record<string, JSONValue>>,
): ToolCallRepairFunction<TOOLS> {
  return async ({ error, instructions, messages, toolCall, tools }) => {
    if (NoSuchToolError.isInstance(error)) return null
    const selectedTool = tools[toolCall.toolName as keyof TOOLS]
    if (!selectedTool) return null

    const repairTools = { [toolCall.toolName]: selectedTool } as ToolSet
    const result = await generateText({
      model,
      ...(providerOptions ? { providerOptions } : {}),
      ...(instructions ? { instructions } : {}),
      messages: [
        ...messages,
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              output: { type: "error-text", value: error.message },
            },
          ],
        },
      ],
      tools: repairTools,
      activeTools: [toolCall.toolName],
      toolChoice: { type: "tool", toolName: toolCall.toolName },
      reasoning: "none",
      maxOutputTokens: 4_096,
      stopWhen: isStepCount(1),
    })
    const repaired = result.toolCalls.find((candidate) => candidate.toolName === toolCall.toolName)
    return repaired
      ? {
          ...toolCall,
          input: JSON.stringify(repaired.input),
        }
      : null
  }
}

export function createTaskAgent<TOOLS extends ToolSet>({
  baseInstructions,
  model,
  modelContextLimits,
  onContextManifest,
  onRunMetrics,
  providerOptions,
  toolGroups = {},
  tools,
}: {
  baseInstructions?: string
  model: LanguageModel
  modelContextLimits: TaskModelContextLimits
  onContextManifest?: (manifest: TaskContextManifest) => void
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  providerOptions?: Record<string, Record<string, JSONValue>>
  toolGroups?: TaskAgentToolGroups
  tools: TOOLS
}) {
  const toolNames = Object.keys(tools)
  const completedSteps: GenerateTextStepEndEvent<ToolSet>[] = []
  const agent = new ToolLoopAgent<TaskAgentCallOptions, ToolSet>({
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
      const activeTools = activeTaskAgentTools(toolNames, options.policy.toolScope, toolGroups)
      return {
        ...settings,
        activeTools,
        maxRetries: TASK_PROVIDER_MAX_RETRIES,
        ...(instructions ? { instructions } : {}),
        ...(options.policy.limits.maxOutputTokens
          ? { maxOutputTokens: options.policy.limits.maxOutputTokens }
          : {}),
        reasoning: reasoningLevel(options.policy.reasoning),
        repairToolCall: createTaskToolCallRepair(model, providerOptions),
        stopWhen: [isStepCount(options.policy.limits.maxSteps)],
        prepareStep: ({ messages, stepNumber }) => {
          const orderedMessages = canonicalizeToolResultOrder(messages)
          const initialManifest = createTaskContextManifest({
            activeToolNames: activeTools,
            instructions: instructions ?? "",
            limits: modelContextLimits,
            messages: orderedMessages,
            observedStep: stepNumber,
            policyMaxOutputTokens: options.policy.limits.maxOutputTokens,
          })
          const fixedTokens = initialManifest.sections
            .filter((section) => section.kind !== "conversation" && section.kind !== "tool-results")
            .reduce((total, section) => total + section.estimatedTokens, 0)
          const projection = compactTaskModelMessages({
            availableInputTokens: initialManifest.availableInputTokens,
            estimatedTokensBefore: initialManifest.estimatedInputTokens,
            fixedTokens,
            messages: orderedMessages,
          })
          const projectedManifest = projection.compaction
            ? createTaskContextManifest({
                activeToolNames: activeTools,
                instructions: instructions ?? "",
                limits: modelContextLimits,
                messages: projection.messages,
                observedStep: stepNumber,
                policyMaxOutputTokens: options.policy.limits.maxOutputTokens,
              })
            : initialManifest
          const manifest = projection.compaction
            ? {
                ...projectedManifest,
                compaction: {
                  ...projection.compaction,
                  estimatedTokensAfter: projectedManifest.estimatedInputTokens,
                },
              }
            : projectedManifest
          onContextManifest?.(manifest)
          assertTaskContextBudget(manifest)
          return {
            activeTools,
            ...(instructions ? { instructions } : {}),
            messages: projection.messages,
          }
        },
      }
    },
  })
  // 本工厂不接受 toolsContext，所有工具都按无自定义 Context 的 ToolSet 运行；
  // 构造时使用 SDK 的宽 ToolSet 规避泛型条件属性，返回时恢复调用方的具体工具映射供 UIMessage 推导。
  return agent as unknown as ToolLoopAgent<TaskAgentCallOptions, TOOLS>
}
