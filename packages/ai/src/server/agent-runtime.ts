/**
 * [INPUT]: 已解析供应商连接与模型上下文上限、自动联网/思考策略、当前 Skill、完整 AI SDK UIMessage 历史、主进程按授权注入的研究/写作交接/内容库/工作区/MCP 能力、中止信号与运行指标/ContextManifest 回调
 * [OUTPUT]: 普通对话和工作区任务共用、先隔离不可重放历史再由 createAgentUIStream 标准转换模型消息，同时承载逐步上下文预算、供应商原生搜索及预算耗尽续答、可信研究闭环、证据化写作交接、内容领域、按请求相关性与 RunPolicy 双重收窄的工作区读写、强制审批 MCP、供应商错误分类、Skill instructions、标准 needsApproval、回答后类型化引申问题与原生生命周期观测的 AI SDK ToolLoopAgent 增量流
 * [POS]: @tessera/ai/server 中统一自然对话的 ToolLoopAgent 编排边界
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/agent-file-capabilities.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-observability.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
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
import { ToolLoopAgent, createAgentUIStream, dynamicTool, isStepCount, jsonSchema, tool } from "ai"
import type { InferAgentUIMessage, JSONSchema7, ToolSet } from "ai"
import { z } from "zod"
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
import { type ContentDomainAgentTools, createContentDomainToolSet } from "./content-domain-tools"
import { generateFollowUpQuestions, mergeFollowUpRunMetrics } from "./follow-up-questions"
import { type ResearchAgentTools, createResearchToolSet, publicResearchToolOutput } from "./research-tools"
import { buildTaskSkillInstructions } from "./skill-instructions"
import { type TaskAgentRunMetrics, createTaskAgent } from "./task-agent"
import {
  createTaskInteractionTools,
  hasRequestedUserInputSinceLastUserMessage,
} from "./task-interaction-tools"

export const workspaceDocumentChangeInputSchema = z
  .strictObject({
    operation: z.enum(["create", "update"]).describe("创建新文档或更新已有文档"),
    path: z.string().min(1).max(1_024).describe("要创建或更新的 Markdown 文件相对路径"),
    content: z.string().max(262_144).describe("完整候选 Markdown 内容"),
    reason: z.string().min(1).max(2_000).describe("本次修改的简短理由"),
    baseModifiedAt: z
      .number()
      .nonnegative()
      .optional()
      .describe("更新已有文档时必填：读取文件时返回的 modifiedAt"),
    baseContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional()
      .describe("更新已有文档时必填：读取文件时返回的 contentHash"),
  })
  .superRefine((input, context) => {
    if (input.operation !== "update") return
    if (input.baseModifiedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseModifiedAt"],
        message: "更新已有文档必须提供 baseModifiedAt",
      })
    }
    if (input.baseContentHash === undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseContentHash"],
        message: "更新已有文档必须提供 baseContentHash",
      })
    }
  })

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
  contentTools?: ContentDomainAgentTools
  externalTools?: readonly ExternalAgentTool[]
  onChunk: (chunk: AiChatStreamChunk) => void | Promise<void>
  onContextManifest?: (manifest: TaskContextManifest) => void
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  researchContext?: string
  researchTools?: ResearchAgentTools
  skill?: LoadedSkill
  tools?: WorkspaceAgentTools
  workspaceName?: string
}>

export type AiSdkAgentRuntimeRequest = Readonly<{
  contentTools?: ContentDomainAgentTools
  externalTools?: readonly ExternalAgentTool[]
  input: AiChatRuntimeInput
  onContextManifest?: (manifest: TaskContextManifest) => void
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  researchContext?: string
  researchTools?: ResearchAgentTools
  skill?: LoadedSkill
  tools?: WorkspaceAgentTools
  workspaceName?: string
}>

export function shouldHideResearchDraftText(chunkType: string, outcome: "complete" | "partial" | null) {
  return !outcome && (chunkType === "text-start" || chunkType === "text-delta" || chunkType === "text-end")
}

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

function agentInstructions(
  workspaceName: string | undefined,
  contentLibraryAvailable: boolean,
  researchContext?: string,
) {
  return `你是 Tessera 的统一创作 Agent。用户不需要选择 Chat 或 Agent；你应自然回答，并在任务确实需要时自行调用当前可用工具。

${workspaceName ? `当前已授权工作区「${workspaceName}」中的 Markdown 文档。` : "当前没有已授权的外部工作区。"}
${contentLibraryAvailable ? "当前可使用托管内容库；正式产物默认创建到“未归档”。" : "当前没有配置托管内容库；需要保存正式产物时应说明如何在设置中选择内容库。"}

规则：
1. 普通问答直接回答；需要最新事实时搜索，需要工作区事实时先调用读取工具，不要猜测文件内容。工作区授权只表示可用，不表示与当前问题相关；用户没有明确提到工作区、文档、附件或本地材料时，不要为了“看看有没有记录”而读取工作区。
2. 历史消息里 state=output-available 的工具结果已经完成；优先直接使用，不要重复执行相同搜索或读取，除非结果明确过期、缺失或冲突。读取结果的 truncation.nextOffset 非空时，按需继续读取后续行；lineTruncated=true 时改用搜索定位并说明限制。回答中的工作区结论使用可点击 Markdown 链接，格式为“[路径:行号](路径#L行号)”；没有行号时使用“[路径](路径)”。
3. 修改已有文档前必须先按 nextOffset 读取全部最新内容，并把读取结果中的 modifiedAt 和 contentHash 原样传给写工具；存在 lineTruncated 时不得提出覆盖式更新。创建文档使用 create 操作。
4. 写工具输入必须是完整候选 Markdown，并简要说明修改理由。写工具只会先请求用户审批；用户批准后才会在下一轮执行。
5. 用户拒绝后不要在没有新要求或实质不同方案时重复提出同一修改。
6. 工具返回冲突时重新读取文件并说明差异，不得覆盖磁盘新版本。
7. 跨越很多文件、会明显挤占主对话上下文的独立研究可以委派给只读研究子 Agent；简单问题直接使用读取工具。
8. 不能删除、重命名、运行 Shell 或扩大访问范围；工具返回截断或限制信息时明确说明。
9. MCP 工具来自用户显式启用的外部服务器，每次执行都必须等待用户批准；不要用多个相似 MCP 调用绕过拒绝。
10. 只有用户明确要求“写成稿、保存、创建文档或交付正式内容”时才创建 Artifact；不要把普通回答自动存成文件。
11. 创建正式文档时，未明确指定项目就省略 projectId，让它进入“未归档”；不要编造项目 ID。
12. 只有用户明确要求建立独立项目或移动文档时才调用对应工具；移动前先查询当前任务 Artifact 和项目 ID，不得覆盖同名文档。${researchContext ? `\n\n${researchContext}` : ""}`
}

const WORKSPACE_REQUEST_PATTERN =
  /(?:工作区|代码库|仓库|源码|本地(?:文件|文档|资料)|当前(?:文档|文件|草稿)|这(?:篇|份|个)(?:文档|文件|草稿)|上面(?:的)?(?:文档|文件|附件)|附件|目录|文件|文档|草稿|README|AGENTS\.md|SKILL\.md|\b[\w./-]+\.md\b)/iu
const CONTINUATION_REFERENCE_PATTERN = /(?:继续|刚才|前面|上面|这个|这点|那(?:个|点)?|其余|第二点)/u
const WORKSPACE_TOOL_NAMES = new Set([
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
  if (WORKSPACE_REQUEST_PATTERN.test(requestText)) return true
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
    contentTools,
    externalTools = [],
    input,
    onContextManifest,
    onRunMetrics,
    researchContext,
    researchTools,
    skill,
    tools: workspaceTools,
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
  const readonlyTools: ToolSet = relevantWorkspaceTools
    ? {
        "list-workspace-files": tool({
          description: "列出工作区或指定目录中的 Markdown 文件，返回相对路径、大小和更新时间。",
          inputSchema: z.strictObject({
            directory: z.string().max(512).optional().describe("工作区相对目录；省略表示工作区根目录"),
          }),
          execute: (toolInput, options) =>
            relevantWorkspaceTools.listWorkspaceFiles(toolInput, options.abortSignal ?? abortSignal),
        }),
        "read-workspace-file": tool({
          description:
            "分页读取一个工作区内 Markdown 文件。路径必须是工作区相对路径；结果截断时使用 truncation.nextOffset 继续。",
          inputSchema: z.strictObject({
            path: z.string().min(1).max(1_024).describe("要读取的 Markdown 文件相对路径"),
            offset: z.number().int().min(1).optional().describe("从 1 开始的起始行；省略表示第一行"),
            limit: z.number().int().min(1).max(1_000).optional().describe("本次最多返回的行数"),
          }),
          execute: (toolInput, options) =>
            relevantWorkspaceTools.readWorkspaceFile(toolInput, options.abortSignal ?? abortSignal),
        }),
        "search-workspace-text": tool({
          description: "在工作区 Markdown 文件中搜索纯文本，返回相对路径、行号和匹配行。",
          inputSchema: z.strictObject({
            query: z.string().min(1).max(200).describe("不区分大小写的纯文本查询"),
            directory: z.string().max(512).optional().describe("可选的工作区相对目录"),
          }),
          execute: (toolInput, options) =>
            relevantWorkspaceTools.searchWorkspaceText(toolInput, options.abortSignal ?? abortSignal),
        }),
        "read-current-document": tool({
          description: "读取用户当前在 Tessera 编辑器中打开的 Markdown 文档；没有当前文档时返回明确状态。",
          inputSchema: z.strictObject({}),
          execute: (_toolInput, options) =>
            relevantWorkspaceTools.readCurrentDocument(options.abortSignal ?? abortSignal),
        }),
      }
    : {}
  const workspaceResearchTools: ToolSet = {}
  if (relevantWorkspaceTools) {
    const researchSubagent = new ToolLoopAgent({
      model,
      instructions: `你是 Tessera 的只读工作区研究子 Agent。使用工具完成一个边界明确的研究任务，不能修改文件。
完成后输出包含关键结论、可点击 Markdown 文件引用和限制说明的紧凑摘要，供主 Agent 继续工作。`,
      tools: readonlyTools,
      maxOutputTokens: 2_048,
      stopWhen: isStepCount(5),
    })
    workspaceResearchTools["delegate-workspace-research"] = tool({
      description: "把跨多个 Markdown 文件、上下文消耗较大的独立研究委派给只读子 Agent。",
      inputSchema: z.strictObject({
        task: z.string().min(1).max(2_000).describe("边界明确、可独立完成的工作区研究任务"),
      }),
      execute: async ({ task }, options) => {
        const result = await researchSubagent.generate({
          prompt: task,
          abortSignal: options.abortSignal ?? abortSignal,
        })
        return { summary: result.text, usage: result.usage }
      },
    })
  }
  const mcpTools = createExternalAgentToolSet(externalTools, abortSignal)
  const contentDomainTools = contentTools ? createContentDomainToolSet(contentTools, abortSignal) : {}
  const researchWorkflow = researchTools ? createResearchToolSet(researchTools, abortSignal) : null
  const workspaceWriteTools: ToolSet = relevantWorkspaceTools
    ? {
        "write-workspace-document": tool({
          description:
            "创建或更新工作区 Markdown 文档。调用会先展示完整候选内容和 Diff，只有用户明确批准后才执行。",
          inputSchema: workspaceDocumentChangeInputSchema,
          needsApproval: true,
          execute: (toolInput, options) =>
            relevantWorkspaceTools.writeWorkspaceDocument(toolInput, {
              signal: options.abortSignal ?? abortSignal,
              toolCallId: options.toolCallId,
            }),
        }),
      }
    : {}
  const tools = {
    ...(runtime.tools ?? {}),
    ...contentDomainTools,
    ...readonlyTools,
    ...workspaceResearchTools,
    ...createTaskInteractionTools(input.runPolicy.skillId, {
      allowUserInput: !hasRequestedUserInputSinceLastUserMessage(input.messages),
      includeResearchPlan: !researchWorkflow,
    }),
    ...(researchWorkflow?.tools ?? {}),
    ...workspaceWriteTools,
    ...mcpTools,
  }
  let latestRunMetrics: TaskAgentRunMetrics | null = null
  const captureRunMetrics = (metrics: TaskAgentRunMetrics) => {
    latestRunMetrics = metrics
    onRunMetrics?.(metrics)
  }
  const agent = createTaskAgent({
    baseInstructions: agentInstructions(workspaceName, Boolean(contentTools), researchContext),
    model,
    modelContextLimits: input.modelContextLimits,
    ...(onContextManifest ? { onContextManifest } : {}),
    ...(onRunMetrics ? { onRunMetrics: captureRunMetrics } : {}),
    ...(runtime.providerOptions ? { providerOptions: runtime.providerOptions } : {}),
    ...(researchWorkflow ? { researchWorkflow } : {}),
    tools,
    toolGroups: {
      external: externalTools.map((externalTool) => externalTool.id),
      workspaceRead: [...Object.keys(readonlyTools), ...Object.keys(workspaceResearchTools)],
      workspaceWrite: Object.keys(workspaceWriteTools),
    },
  })
  type AgentUiMessage = InferAgentUIMessage<typeof agent>
  const originalMessages = await toUiMessages<AgentUiMessage>(
    taskMessagesForModel(input.messages, input.continueFromMessageId),
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
            output: publicResearchToolOutput(toolNames.get(chunk.toolCallId) ?? "", chunk.output),
          }
        : chunk
    if (
      researchWorkflow &&
      shouldHideResearchDraftText(publicInput.type, researchWorkflow.getProgress().outcome)
    ) {
      continue
    }
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
    contentTools,
    externalTools,
    onChunk,
    onContextManifest,
    onRunMetrics,
    researchContext,
    researchTools,
    skill,
    tools,
    workspaceName,
  }: AiAgentRuntimeOptions,
): Promise<void> {
  for await (const chunk of aiSdkAgentRuntime.run(
    {
      input,
      ...(contentTools ? { contentTools } : {}),
      ...(onRunMetrics ? { onRunMetrics } : {}),
      ...(onContextManifest ? { onContextManifest } : {}),
      ...(researchContext ? { researchContext } : {}),
      ...(researchTools ? { researchTools } : {}),
      ...(tools ? { tools } : {}),
      ...(workspaceName ? { workspaceName } : {}),
      ...(externalTools ? { externalTools } : {}),
      ...(skill ? { skill } : {}),
    },
    abortSignal,
  )) {
    await onChunk(chunk)
  }
}
