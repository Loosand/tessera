/**
 * [INPUT]: 已解析供应商连接与模型上下文上限、自动联网/思考策略、当前 Skill、完整 AI SDK UIMessage 历史、主进程按授权注入的 Web/read-edit-write-bash/MCP 能力、中止信号与运行指标/ContextManifest 回调
 * [OUTPUT]: 普通对话和工作区任务共用、先按当前工具集隔离不可重放历史再由 createAgentUIStream 标准转换模型消息，同时承载逐步上下文预算、可选 Web、按请求相关性与 RunPolicy 双重收窄的 read/edit/write/bash、强制审批 MCP、供应商错误分类、Skill instructions、回答后类型化引申问题与原生生命周期观测的轻量 AI SDK ToolLoopAgent 增量流
 * [POS]: @tessera/ai/server 中统一自然对话的 ToolLoopAgent 编排边界
 * [DOC]: docs/architecture/agent-simplification-roadmap.md、docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-observability.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentRuntime, WorkspaceAgentTools } from "@tessera/agent-runtime"
import type {
  AiChatStreamChunk,
  TaskContextManifest,
  TaskMessage,
  TaskRunErrorDataV1,
  TaskToolErrorDataV1,
} from "@tessera/contracts"
import type { LoadedSkill } from "@tessera/skills"
import { createAgentUIStream, dynamicTool, jsonSchema } from "ai"
import type { InferAgentUIMessage, JSONSchema7, ToolSet } from "ai"
import { createAiSdkChatRuntime } from "./ai-sdk-runtime"
import {
  type AiChatRuntimeInput,
  classifyProviderStreamError,
  isWebSearchMaxUsesExceededError,
  publicChunk,
  taskMessagesForModel,
  toUiMessages,
  webSearchMaxUsesForSkill,
} from "./chat-runtime"
import { generateFollowUpQuestions, mergeFollowUpRunMetrics } from "./follow-up-questions"
import { buildTaskSkillInstructions } from "./skill-instructions"
import { type TaskAgentRunMetrics, createTaskAgent } from "./task-agent"
import {
  createTaskInteractionTools,
  hasRequestedUserInputSinceLastUserMessage,
} from "./task-interaction-tools"
import { type WebAgentTools, createWebToolSet, publicWebToolOutput } from "./web-tools"
import { createWorkspaceAiToolSet } from "./workspace-tools"

export type ExternalAgentTool = Readonly<{
  description: string
  execute: (
    input: unknown,
    context: Readonly<{ signal: AbortSignal; toolCallId: string }>,
  ) => Promise<unknown>
  id: string
  inputSchema: Record<string, unknown>
  title: string
}>

export type AiAgentRuntimeOptions = Readonly<{
  abortSignal: AbortSignal
  externalTools?: readonly ExternalAgentTool[]
  onChunk: (chunk: AiChatStreamChunk) => void | Promise<void>
  onContextManifest?: (manifest: TaskContextManifest) => void
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  skill?: LoadedSkill
  tools?: WorkspaceAgentTools
  webTools?: WebAgentTools
  workspaceName?: string
}>

export type AiSdkAgentRuntimeRequest = Readonly<{
  externalTools?: readonly ExternalAgentTool[]
  input: AiChatRuntimeInput
  onContextManifest?: (manifest: TaskContextManifest) => void
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  skill?: LoadedSkill
  tools?: WorkspaceAgentTools
  webTools?: WebAgentTools
  workspaceName?: string
}>

function lastUserRequest(messages: AiChatRuntimeInput["messages"]) {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user")
  return (
    message?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  )
}

export function createExternalAgentToolSet(
  externalTools: readonly ExternalAgentTool[],
  abortSignal: AbortSignal,
) {
  return Object.fromEntries(
    externalTools.map((externalTool) => [
      externalTool.id,
      dynamicTool({
        description: `${externalTool.title}：${externalTool.description}`,
        inputSchema: jsonSchema(externalTool.inputSchema as JSONSchema7),
        needsApproval: true,
        execute: (toolInput, options) =>
          externalTool.execute(toolInput, {
            signal: options.abortSignal ?? abortSignal,
            toolCallId: options.toolCallId,
          }),
      }),
    ]),
  ) satisfies ToolSet
}

export function agentInstructions(workspaceName?: string, currentDocumentPath?: string) {
  const environment = [
    workspaceName ? `当前工作区：${workspaceName}（只允许使用已提供的工作区工具访问）。` : null,
    currentDocumentPath ? `当前文档：${currentDocumentPath}。` : null,
  ].filter(Boolean)
  return `你是 Tessera 中工作的通用 Agent。自然、准确地完成用户请求；简单问题直接回答，需要外部事实或本地材料时使用当前实际可用的工具。

${environment.length > 0 ? `环境：\n${environment.map((line) => `- ${line}`).join("\n")}\n\n` : ""}原则：
1. 不猜测未读取的工作区内容；修改前先 read。局部修改用 edit，创建或完整重写用 write；完整重写前读完同一版本的所有分页，冲突后重新读取。
2. 复用历史中已完成且仍有效的工具结果。结果被截断时按工具返回的行与单行字节续读位置补充读取。
3. 只使用当前提供的工具，不扩大权限；工具失败时根据结构化结果纠正或清楚说明限制。
4. 回答简洁清楚；引用工作区事实时使用可点击的相对 Markdown 路径，已知行号时附上行号。`
}

const WORKSPACE_REQUEST_PATTERN =
  /(?:工作区|代码库|仓库|源码|本地(?:文件|文档|资料)|当前(?:文档|文件|草稿)|这(?:篇|份|个)(?:文档|文件|草稿)|上面(?:的)?(?:文档|文件|附件)|附件|目录|文件|文档|草稿|README|AGENTS\.md|SKILL\.md|\b[\w./-]+\.md\b)/iu
const WORKSPACE_EXECUTION_PATTERN =
  /(?:(?:跑|运行|执行)(?:一下|下|一遍|一轮)?\s*(?:测试|单测|构建|编译|打包|检查|命令|脚本|lint|typecheck|bun\b|pnpm\b|npm\b|yarn\b|cargo\b|make\b)|\b(?:run|execute)\s+(?:the\s+)?(?:tests?|build|lint|typecheck|checks?|script|bun|pnpm|npm|yarn|cargo|make)\b|\b(?:bun|pnpm|npm|yarn|cargo)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b)/iu
const CONTINUATION_REFERENCE_PATTERN = /(?:继续|刚才|前面|上面|这个|这点|那(?:个|点)?|其余|第二点)/u
const WORKSPACE_TOOL_NAMES = new Set([
  "bash",
  "read",
  "edit",
  "write",
  "list-workspace-files",
  "read-workspace-file",
  "search-workspace-text",
  "read-current-document",
  "delegate-workspace-research",
  "write-workspace-document",
])

function taskMessageText(message: TaskMessage | undefined) {
  return (
    message?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  )
}

function taskToolName(part: TaskMessage["parts"][number]) {
  if (part.type === "dynamic-tool") return part.toolName
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : undefined
}

const WEB_SEARCH_TOOL_NAME = "web_search"
const WEB_SEARCH_BUDGET_MESSAGE = "本轮联网搜索预算已用完，正在使用已有结果继续整理。"

/** 把兼容端点误报的顶层搜索额度错误恢复为 AI SDK 标准 Tool Error Part。 */
export function webSearchBudgetToolErrorChunk(toolCallId: string): AiChatStreamChunk {
  const failure: TaskToolErrorDataV1 = {
    code: "execution",
    message: WEB_SEARCH_BUDGET_MESSAGE,
    retryable: false,
    toolCallId,
    toolName: WEB_SEARCH_TOOL_NAME,
    version: 1,
  }
  return {
    type: "tool-output-error",
    toolCallId,
    errorText: failure.message,
    failure,
    providerExecuted: true,
  }
}

export function canCompleteAfterWebSearchBudget(answerAfterBudget: string, textEndedAfterBudget: boolean) {
  return textEndedAfterBudget && answerAfterBudget.trim().length > 0
}

/** 工作区是按请求相关性开放的能力，不是进入工作区后每轮都自动注入的背景。 */
export function workspaceAccessRelevant(messages: readonly TaskMessage[], currentDocumentPath?: string) {
  let latestUserIndex = -1
  if (currentDocumentPath) return true
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index
      break
    }
  }
  const latestUser = latestUserIndex >= 0 ? messages[latestUserIndex] : undefined
  if (!latestUser) return false
  if (latestUser.parts.some((part) => part.type === "file" && part.mediaType === "text/markdown")) return true
  const requestText = taskMessageText(latestUser)
  if (WORKSPACE_REQUEST_PATTERN.test(requestText) || WORKSPACE_EXECUTION_PATTERN.test(requestText))
    return true
  if (!CONTINUATION_REFERENCE_PATTERN.test(requestText)) return false
  const previousAssistant = messages
    .slice(0, latestUserIndex)
    .reverse()
    .find((message) => message.role === "assistant")
  return Boolean(
    previousAssistant?.parts.some((part) => {
      const name = taskToolName(part)
      return name ? WORKSPACE_TOOL_NAMES.has(name) : false
    }),
  )
}

async function* runAiSdkAgent(
  {
    externalTools = [],
    input,
    onContextManifest,
    onRunMetrics,
    skill,
    tools: workspaceTools,
    webTools,
    workspaceName,
  }: AiSdkAgentRuntimeRequest,
  abortSignal: AbortSignal,
): AsyncIterable<AiChatStreamChunk> {
  const runtime = createAiSdkChatRuntime(input, {
    webSearch: input.runPolicy.webSearch,
    webSearchMaxUses: webSearchMaxUsesForSkill(input.runPolicy.skillId),
  })
  const model = runtime.model
  const skillInstructions = await buildTaskSkillInstructions(input.runPolicy.skillId, skill)
  const relevantWorkspaceTools =
    workspaceTools && workspaceAccessRelevant(input.messages, input.currentDocumentPath)
      ? workspaceTools
      : undefined
  const workspaceToolSet = relevantWorkspaceTools
    ? createWorkspaceAiToolSet(relevantWorkspaceTools, abortSignal, input.runPolicy.toolScope)
    : null
  const workspaceReadTools = workspaceToolSet?.readTools ?? {}
  const webToolSet = input.runPolicy.webSearch && webTools ? createWebToolSet(webTools, abortSignal) : {}
  const mcpTools = createExternalAgentToolSet(externalTools, abortSignal)
  const workspaceWriteTools = workspaceToolSet?.writeTools ?? {}
  const tools = {
    ...(runtime.tools ?? {}),
    ...webToolSet,
    ...workspaceReadTools,
    ...createTaskInteractionTools({
      allowUserInput: !hasRequestedUserInputSinceLastUserMessage(input.messages),
    }),
    ...workspaceWriteTools,
    ...mcpTools,
  }
  let latestRunMetrics: TaskAgentRunMetrics | null = null
  const captureRunMetrics = (metrics: TaskAgentRunMetrics) => {
    latestRunMetrics = metrics
    onRunMetrics?.(metrics)
  }
  const agent = createTaskAgent({
    baseInstructions: agentInstructions(workspaceName, input.currentDocumentPath),
    model,
    modelContextLimits: input.modelContextLimits,
    ...(onContextManifest ? { onContextManifest } : {}),
    ...(onRunMetrics ? { onRunMetrics: captureRunMetrics } : {}),
    ...(runtime.providerOptions ? { providerOptions: runtime.providerOptions } : {}),
    tools,
    toolGroups: {
      external: externalTools.map((externalTool) => externalTool.id),
      workspaceRead: Object.keys(workspaceReadTools),
      workspaceWrite: Object.keys(workspaceWriteTools),
    },
  })
  type AgentUiMessage = InferAgentUIMessage<typeof agent>
  const originalMessages = await toUiMessages<AgentUiMessage>(
    taskMessagesForModel(input.messages, input.continueFromMessageId, new Set(Object.keys(tools))),
    { tools },
  )
  const classifiedStreamFailures: Array<{
    failure: TaskRunErrorDataV1
    webSearchBudgetExceeded: boolean
  }> = []
  const stream = await createAgentUIStream({
    agent,
    uiMessages: originalMessages,
    originalMessages,
    abortSignal,
    options: {
      policy: input.runPolicy,
      ...(skillInstructions ? { skillInstructions } : {}),
    },
    timeout: {
      totalMs: input.runPolicy.limits.timeoutMs,
      firstChunkMs: 120_000,
      chunkMs: 180_000,
    },
    sendReasoning: true,
    sendSources: true,
    onError: (error) => {
      const failure = classifyProviderStreamError(error, input.apiKey)
      classifiedStreamFailures.push({
        failure,
        webSearchBudgetExceeded: isWebSearchMaxUsesExceededError(error, input.apiKey),
      })
      return failure.message
    },
  })

  const toolNames = new Map<string, string>()
  const pendingToolCallIds = new Set<string>()
  let finalAnswer = ""
  let finishChunk: AiChatStreamChunk | null = null
  let webSearchBudgetExceeded = false
  let webSearchBudgetFailure: TaskRunErrorDataV1 | null = null
  let deferredPostBudgetFailure: TaskRunErrorDataV1 | null = null
  let answerAfterBudget = ""
  let textEndedAfterBudget = false
  const takeClassifiedFailure = (errorText: string) => {
    const index = classifiedStreamFailures.findIndex(({ failure }) => failure.message === errorText)
    if (index < 0) return null
    return classifiedStreamFailures.splice(index, 1)[0] ?? null
  }
  const markWebSearchBudgetExceeded = (failure: TaskRunErrorDataV1) => {
    if (!webSearchBudgetExceeded) {
      webSearchBudgetExceeded = true
      answerAfterBudget = ""
      textEndedAfterBudget = false
    }
    webSearchBudgetFailure ??= failure
  }
  for await (const chunk of stream) {
    if (
      chunk.type === "tool-input-start" ||
      chunk.type === "tool-input-available" ||
      chunk.type === "tool-input-error"
    ) {
      toolNames.set(chunk.toolCallId, chunk.toolName)
      pendingToolCallIds.add(chunk.toolCallId)
    }
    if (
      chunk.type === "tool-output-available" ||
      chunk.type === "tool-output-error" ||
      chunk.type === "tool-output-denied" ||
      chunk.type === "tool-input-error"
    ) {
      pendingToolCallIds.delete(chunk.toolCallId)
    }
    const publicInput =
      chunk.type === "tool-output-available"
        ? {
            ...chunk,
            output: publicWebToolOutput(toolNames.get(chunk.toolCallId) ?? "", chunk.output),
          }
        : chunk
    const sanitized = publicChunk(publicInput)
    if (!sanitized) continue
    const classifiedFailure = "errorText" in sanitized ? takeClassifiedFailure(sanitized.errorText) : null
    if (
      sanitized.type === "tool-output-error" &&
      toolNames.get(sanitized.toolCallId) === WEB_SEARCH_TOOL_NAME &&
      isWebSearchMaxUsesExceededError(new Error(sanitized.errorText), input.apiKey)
    ) {
      const failure =
        classifiedFailure?.failure ??
        classifyProviderStreamError(new Error(sanitized.errorText), input.apiKey)
      markWebSearchBudgetExceeded(failure)
      yield webSearchBudgetToolErrorChunk(sanitized.toolCallId)
      continue
    }
    if (sanitized.type === "error") {
      const failure =
        classifiedFailure?.failure ??
        classifyProviderStreamError(new Error(sanitized.errorText), input.apiKey)
      const budgetExceeded =
        classifiedFailure?.webSearchBudgetExceeded === true ||
        isWebSearchMaxUsesExceededError(new Error(sanitized.errorText), input.apiKey)
      if (budgetExceeded) {
        markWebSearchBudgetExceeded(failure)
        const pendingSearchCall = Array.from(toolNames.entries())
          .reverse()
          .find(
            ([toolCallId, toolName]) =>
              toolName === WEB_SEARCH_TOOL_NAME && pendingToolCallIds.has(toolCallId),
          )
        if (pendingSearchCall) {
          pendingToolCallIds.delete(pendingSearchCall[0])
          yield webSearchBudgetToolErrorChunk(pendingSearchCall[0])
        }
        continue
      }
      if (webSearchBudgetExceeded) {
        deferredPostBudgetFailure = failure
        continue
      }
      sanitized.failure = failure
    }
    if (sanitized.type === "text-start" && webSearchBudgetExceeded) textEndedAfterBudget = false
    if (sanitized.type === "text-delta") {
      finalAnswer += sanitized.delta
      if (webSearchBudgetExceeded) answerAfterBudget += sanitized.delta
    }
    if (sanitized.type === "text-end" && webSearchBudgetExceeded) textEndedAfterBudget = true
    if (sanitized.type === "finish") {
      finishChunk = sanitized
      continue
    }
    yield sanitized
  }

  const recoveredFinishChunk: AiChatStreamChunk | null =
    !finishChunk && canCompleteAfterWebSearchBudget(answerAfterBudget, textEndedAfterBudget)
      ? { type: "finish", finishReason: "stop" }
      : null
  const resolvedFinishChunk = finishChunk ?? recoveredFinishChunk
  if (!resolvedFinishChunk) {
    const terminalFailure = deferredPostBudgetFailure ?? webSearchBudgetFailure
    if (terminalFailure) {
      yield { type: "error", errorText: terminalFailure.message, failure: terminalFailure }
    }
  }

  if (
    resolvedFinishChunk &&
    (resolvedFinishChunk.finishReason === undefined || resolvedFinishChunk.finishReason === "stop") &&
    finalAnswer.trim() &&
    !abortSignal.aborted
  ) {
    try {
      const followUp = await generateFollowUpQuestions({
        abortSignal,
        answer: finalAnswer,
        model,
        ...(runtime.providerOptions ? { providerOptions: runtime.providerOptions } : {}),
        skillId: input.runPolicy.skillId,
        userRequest: lastUserRequest(input.messages),
      })
      if (followUp) {
        if (followUp.data) {
          yield {
            type: "data-follow-up-questions",
            id: `follow-up-questions-${input.requestId}`,
            data: followUp.data,
          }
        }
        if (latestRunMetrics && onRunMetrics) {
          onRunMetrics(mergeFollowUpRunMetrics(latestRunMetrics, followUp.metrics))
        }
      }
    } catch {
      // 引申问题是非关键增强；失败或超时不能把已经完成的主回答改成失败。
    }
  }
  if (resolvedFinishChunk) yield resolvedFinishChunk
}

export const aiSdkAgentRuntime: AgentRuntime<AiSdkAgentRuntimeRequest, AiChatStreamChunk> = {
  id: "ai-sdk-tool-loop",
  run: runAiSdkAgent,
}

export async function streamAiAgent(
  input: AiChatRuntimeInput,
  {
    abortSignal,
    externalTools,
    onChunk,
    onContextManifest,
    onRunMetrics,
    skill,
    tools,
    webTools,
    workspaceName,
  }: AiAgentRuntimeOptions,
): Promise<void> {
  for await (const chunk of aiSdkAgentRuntime.run(
    {
      input,
      ...(onRunMetrics ? { onRunMetrics } : {}),
      ...(onContextManifest ? { onContextManifest } : {}),
      ...(tools ? { tools } : {}),
      ...(webTools ? { webTools } : {}),
      ...(workspaceName ? { workspaceName } : {}),
      ...(externalTools ? { externalTools } : {}),
      ...(skill ? { skill } : {}),
    },
    abortSignal,
  )) {
    await onChunk(chunk)
  }
}
