/**
 * [INPUT]: 已解析 TaskRunPolicy、AI SDK LanguageModel、当前请求工具集合、领域 instructions、Telemetry、生命周期观测回调与工具分组
 * [OUTPUT]: 通过 callOptionsSchema/prepareCall 动态收窄推理、工具、安全护栏和 Skill instructions，并以 AI SDK 原生生命周期产出统一运行指标的 ToolLoopAgent
 * [POS]: 无工作区对话与工作区 Agent 共用的 AI SDK 标准动态配置工厂
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  FINALIZE_RESEARCH_TOOL_NAME,
  PUBLISH_RESEARCH_PLAN_TOOL_NAME,
  RECORD_RESEARCH_EVIDENCE_TOOL_NAME,
  REQUEST_USER_INPUT_TOOL_NAME,
  type TaskResearchProgress,
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
import type { ResearchWorkflowController } from "./research-tools"

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

export type ResearchStepPolicy = Readonly<{
  activeTools: string[]
  mode: "evidence" | "final-answer" | "finalize-partial" | "plan" | "research"
  toolChoice: "none" | "required"
}>

export function researchStepPolicy(
  input: Readonly<{
    activeTools: readonly string[]
    maxSteps: number
    progress: TaskResearchProgress
    stepNumber: number
  }>,
): ResearchStepPolicy {
  if (input.progress.outcome) return { activeTools: [], mode: "final-answer", toolChoice: "none" }
  if (!input.progress.planPublished) {
    return {
      activeTools: input.activeTools.filter(
        (name) => name === PUBLISH_RESEARCH_PLAN_TOOL_NAME || name === REQUEST_USER_INPUT_TOOL_NAME,
      ),
      mode: "plan",
      toolChoice: "required",
    }
  }
  const evidenceTools = input.activeTools.filter((name) => name === RECORD_RESEARCH_EVIDENCE_TOOL_NAME)
  if (
    input.progress.sourceCounts.read > 0 &&
    input.progress.evidenceCount === 0 &&
    evidenceTools.length > 0
  ) {
    return { activeTools: evidenceTools, mode: "evidence", toolChoice: "required" }
  }
  if (input.stepNumber >= Math.max(1, input.maxSteps - 2)) {
    return {
      activeTools: input.activeTools.filter((name) => name === FINALIZE_RESEARCH_TOOL_NAME),
      mode: "finalize-partial",
      toolChoice: "required",
    }
  }
  return {
    activeTools: input.activeTools.filter((name) => name !== REQUEST_USER_INPUT_TOOL_NAME),
    mode: "research",
    toolChoice: "required",
  }
}

export function researchRunShouldStopAfterStep(
  input: Readonly<{ finalAnswerStarted: boolean; maxSteps: number; stepCount: number }>,
) {
  return input.finalAnswerStarted || input.stepCount >= input.maxSteps + 2
}

export function createTaskAgent({
  baseInstructions,
  model,
  onRunMetrics,
  providerOptions,
  researchWorkflow,
  toolGroups = {},
  tools,
}: {
  baseInstructions?: string
  model: LanguageModel
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  providerOptions?: Record<string, Record<string, JSONValue>>
  researchWorkflow?: ResearchWorkflowController
  toolGroups?: TaskAgentToolGroups
  tools: ToolSet
}) {
  const toolNames = Object.keys(tools)
  const completedSteps: GenerateTextStepEndEvent<ToolSet>[] = []
  let researchFinalAnswerStarted = false
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
      const activeTools = activeTaskAgentTools(toolNames, options.policy.toolScope, toolGroups)
      return {
        ...settings,
        activeTools,
        ...(instructions ? { instructions } : {}),
        ...(options.policy.limits.maxOutputTokens
          ? { maxOutputTokens: options.policy.limits.maxOutputTokens }
          : {}),
        reasoning: reasoningLevel(options.policy.reasoning),
        stopWhen: [
          researchWorkflow
            ? ({ steps }) =>
                researchRunShouldStopAfterStep({
                  finalAnswerStarted: researchFinalAnswerStarted,
                  maxSteps: options.policy.limits.maxSteps,
                  stepCount: steps.length,
                })
            : isStepCount(options.policy.limits.maxSteps),
        ],
        ...(researchWorkflow
          ? {
              prepareStep: ({ stepNumber }: { stepNumber: number }) => {
                const policy = researchStepPolicy({
                  activeTools,
                  maxSteps: options.policy.limits.maxSteps,
                  progress: researchWorkflow.getProgress(),
                  stepNumber,
                })
                if (policy.mode === "final-answer") researchFinalAnswerStarted = true
                const phaseInstruction =
                  policy.mode === "plan"
                    ? "运行时要求：这是显式研究。必须先调用 publish-research-plan；只有核心语义确实歧义时才可改为 request-user-input。"
                    : policy.mode === "evidence"
                      ? "运行时要求：已经深读来源但尚未登记证据。现在只调用 record-research-evidence；可并行登记多个问题的短原文片段，不要继续搜索、阅读或输出最终答复。"
                      : policy.mode === "finalize-partial"
                        ? "运行时要求：研究循环已达到应急安全上限。现在必须调用 finalize-research；满足全部证据门槛时标记 complete，否则以 partial 如实保留未覆盖问题与限制。"
                        : policy.mode === "final-answer"
                          ? "运行时要求：领域完成检查已经通过。现在直接交付最终答复，引用已读来源，清楚说明覆盖与限制，不再调用工具。"
                          : "运行时要求：最终答复前必须调用 finalize-research；继续搜索、深读和登记证据，搜索摘要不能作为已读证据。"
                return {
                  activeTools: policy.activeTools,
                  toolChoice: policy.toolChoice,
                  instructions: [instructions, phaseInstruction].filter(Boolean).join("\n\n"),
                }
              },
            }
          : {}),
      }
    },
  })
}
