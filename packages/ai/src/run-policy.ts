/**
 * [INPUT]: 本轮显式创作方式、内部任务作用域、供应商连接与已归一化模型事实
 * [OUTPUT]: 受信任主进程和渲染层预检共用的实际端点、联网、推理、工具作用域与资源上限 RunPolicy
 * [POS]: 模型请求期路由之后、AI SDK ToolLoopAgent 动态配置之前的单一策略事实源
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-providers.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderId, AiProviderModel, TaskMode, TaskRunPolicy, TaskSkillId } from "@tessera/contracts"
import {
  type AiModelExecution,
  type AiModelExecutionIssue,
  aiModelExecutionIssueMessage,
  resolveAiModelExecution,
} from "./model-routing"

export type TaskRunPolicyIssue = AiModelExecutionIssue | "research-reasoning-unavailable"

export type TaskRunPolicyResolution = {
  execution: AiModelExecution
  issues: TaskRunPolicyIssue[]
  policy: TaskRunPolicy
}

const TASK_TIMEOUT_MS = 120_000
const RESEARCH_TIMEOUT_MS = 30 * 60_000
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096
const DEFAULT_RESEARCH_EMERGENCY_MAX_STEPS = 32

function resolveToolScope(mode: TaskMode, skillId: TaskSkillId): TaskRunPolicy["toolScope"] {
  if (mode === "chat") return "conversation"
  if (skillId === "question-answering") return "workspace-read"
  return "workspace-write"
}

function boundedOutputTokens(model: AiProviderModel, preferred: number) {
  return model.maxOutputTokens ? Math.min(model.maxOutputTokens, preferred) : preferred
}

function researchEmergencyMaxSteps(model: AiProviderModel) {
  if ((model.contextWindow ?? 0) >= 500_000) return 64
  if ((model.contextWindow ?? 0) >= 128_000) return 48
  return DEFAULT_RESEARCH_EMERGENCY_MAX_STEPS
}

function resolveLimits(skillId: TaskSkillId, model: AiProviderModel): TaskRunPolicy["limits"] {
  if (skillId === "research") {
    return {
      // 显式透传模型档案的原生输出上限，避免兼容供应商被 AI SDK 静默回落到 4096。
      // 未知上限仍交给供应商；Tessera 不在研究层另造抽象 token 预算。
      maxOutputTokens: model.maxOutputTokens,
      maxSteps: researchEmergencyMaxSteps(model),
      timeoutMs: RESEARCH_TIMEOUT_MS,
    }
  }
  const maxSteps = skillId === "question-answering" ? 4 : skillId === "writing" ? 6 : 8
  return {
    maxOutputTokens: boundedOutputTokens(model, DEFAULT_MAX_OUTPUT_TOKENS),
    maxSteps,
    timeoutMs: TASK_TIMEOUT_MS,
  }
}

export function resolveTaskRunPolicy(input: {
  baseUrl: string
  mode: TaskMode
  model: AiProviderModel
  providerId: AiProviderId
  skillId: TaskSkillId
}): TaskRunPolicyResolution {
  const resolve = (webSearch: boolean) =>
    resolveAiModelExecution({
      baseUrl: input.baseUrl,
      mode: input.mode,
      model: input.model,
      providerId: input.providerId,
      webSearch,
    })

  let execution: AiModelExecution
  if (input.skillId === "question-answering") {
    execution = resolve(false)
  } else {
    const onlineExecution = resolve(true)
    execution =
      input.skillId === "research" || onlineExecution.issues.length === 0 ? onlineExecution : resolve(false)
  }

  const issues: TaskRunPolicyIssue[] = [...execution.issues]
  if (input.skillId === "research" && execution.capabilities.reasoning !== "supported") {
    issues.push("research-reasoning-unavailable")
  }
  const reasoning =
    input.skillId === "research"
      ? "high"
      : input.skillId !== "question-answering" && execution.capabilities.reasoning === "supported"
        ? "high"
        : "auto"

  return {
    execution,
    issues,
    policy: {
      limits: resolveLimits(input.skillId, input.model),
      mode: input.mode,
      reasoning,
      skillId: input.skillId,
      toolScope: resolveToolScope(input.mode, input.skillId),
      webSearch: execution.searchRoute === "provider-native",
    },
  }
}

export function taskRunPolicyIssueMessage(issue: TaskRunPolicyIssue): string {
  if (issue === "research-reasoning-unavailable") {
    return "研究方式需要支持深度思考的模型，请更换模型或改用自动。"
  }
  return aiModelExecutionIssueMessage(issue)
}
