/**
 * [INPUT]: 已解析供应商连接、自动联网/思考策略、当前 Skill、完整 AI SDK UIMessage 历史、主进程注入的受限工作区/MCP 能力、中止信号与运行指标回调
 * [OUTPUT]: 同时承载供应商原生搜索、按 RunPolicy 收窄的工作区读写、强制审批 MCP、Skill instructions、标准 needsApproval 与原生生命周期观测的 AI SDK ToolLoopAgent 增量流
 * [POS]: @tessera/ai/server 中可读并可经人工批准修改 Markdown 的工作区 Agent 编排边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-observability.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentRuntime } from "@tessera/agent-runtime"
import type { AiChatStreamChunk } from "@tessera/contracts"
import type { LoadedSkill } from "@tessera/skills"
import { ToolLoopAgent, createAgentUIStream, dynamicTool, isStepCount, jsonSchema, tool } from "ai"
import type { InferUITools, JSONSchema7, ToolSet, UIMessage } from "ai"
import { z } from "zod"
import { createAiSdkChatRuntime } from "./ai-sdk-runtime"
import {
  type AiChatRuntimeInput,
  publicChunk,
  safeErrorMessage,
  toUiMessages,
  webSearchMaxUsesForSkill,
} from "./chat-runtime"
import { buildTaskSkillInstructions } from "./skill-instructions"
import { type TaskAgentRunMetrics, createTaskAgent } from "./task-agent"
import {
  createTaskInteractionTools,
  hasRequestedUserInputSinceLastUserMessage,
} from "./task-interaction-tools"

export type ListWorkspaceFilesInput = Readonly<{
  directory?: string | undefined
}>

export type ReadWorkspaceFileInput = Readonly<{
  path: string
}>

export type SearchWorkspaceTextInput = Readonly<{
  directory?: string | undefined
  query: string
}>

export type ReadonlyWorkspaceAgentTools = {
  readonly listWorkspaceFiles: (input: ListWorkspaceFilesInput, signal: AbortSignal) => Promise<unknown>
  readonly readCurrentDocument: (signal: AbortSignal) => Promise<unknown>
  readonly readWorkspaceFile: (input: ReadWorkspaceFileInput, signal: AbortSignal) => Promise<unknown>
  readonly searchWorkspaceText: (input: SearchWorkspaceTextInput, signal: AbortSignal) => Promise<unknown>
}

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

export type WorkspaceDocumentChangeInput = Readonly<z.infer<typeof workspaceDocumentChangeInputSchema>>

export type WorkspaceAgentTools = ReadonlyWorkspaceAgentTools & {
  readonly writeWorkspaceDocument: (
    input: WorkspaceDocumentChangeInput,
    context: Readonly<{ signal: AbortSignal; toolCallId: string }>,
  ) => Promise<unknown>
}

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
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  skill?: LoadedSkill
  tools: WorkspaceAgentTools
  workspaceName: string
}>

export type AiSdkAgentRuntimeRequest = Readonly<{
  externalTools?: readonly ExternalAgentTool[]
  input: AiChatRuntimeInput
  onRunMetrics?: (metrics: TaskAgentRunMetrics) => void
  skill?: LoadedSkill
  tools: WorkspaceAgentTools
  workspaceName: string
}>

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

function agentInstructions(workspaceName: string) {
  return `你是 Tessera 的工作区 Agent，当前授权范围是工作区「${workspaceName}」中的 Markdown 文档。

规则：
1. 需要工作区事实时先调用读取工具，不要猜测文件内容。
2. 回答中的工作区结论使用可点击 Markdown 链接，格式为“[路径:行号](路径#L行号)”；没有行号时使用“[路径](路径)”。
3. 修改已有文档前必须先读取最新内容，并把读取结果中的 modifiedAt 和 contentHash 原样传给写工具；创建文档使用 create 操作。
4. 写工具输入必须是完整候选 Markdown，并简要说明修改理由。写工具只会先请求用户审批；用户批准后才会在下一轮执行。
5. 用户拒绝后不要在没有新要求或实质不同方案时重复提出同一修改。
6. 工具返回冲突时重新读取文件并说明差异，不得覆盖磁盘新版本。
7. 跨越很多文件、会明显挤占主对话上下文的独立研究可以委派给只读研究子 Agent；简单问题直接使用读取工具。
8. 不能删除、重命名、运行 Shell 或扩大访问范围；工具返回截断或限制信息时明确说明。
9. MCP 工具来自用户显式启用的外部服务器，每次执行都必须等待用户批准；不要用多个相似 MCP 调用绕过拒绝。`
}

async function* runAiSdkAgent(
  {
    externalTools = [],
    input,
    onRunMetrics,
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
  const readonlyTools = {
    "list-workspace-files": tool({
      description: "列出工作区或指定目录中的 Markdown 文件，返回相对路径、大小和更新时间。",
      inputSchema: z.strictObject({
        directory: z.string().max(512).optional().describe("工作区相对目录；省略表示工作区根目录"),
      }),
      execute: (toolInput, options) =>
        workspaceTools.listWorkspaceFiles(toolInput, options.abortSignal ?? abortSignal),
    }),
    "read-workspace-file": tool({
      description: "读取一个工作区内 Markdown 文件的文本内容。路径必须来自工作区相对路径。",
      inputSchema: z.strictObject({
        path: z.string().min(1).max(1_024).describe("要读取的 Markdown 文件相对路径"),
      }),
      execute: (toolInput, options) =>
        workspaceTools.readWorkspaceFile(toolInput, options.abortSignal ?? abortSignal),
    }),
    "search-workspace-text": tool({
      description: "在工作区 Markdown 文件中搜索纯文本，返回相对路径、行号和匹配行。",
      inputSchema: z.strictObject({
        query: z.string().min(1).max(200).describe("不区分大小写的纯文本查询"),
        directory: z.string().max(512).optional().describe("可选的工作区相对目录"),
      }),
      execute: (toolInput, options) =>
        workspaceTools.searchWorkspaceText(toolInput, options.abortSignal ?? abortSignal),
    }),
    "read-current-document": tool({
      description: "读取用户当前在 Tessera 编辑器中打开的 Markdown 文档；没有当前文档时返回明确状态。",
      inputSchema: z.strictObject({}),
      execute: (_toolInput, options) =>
        workspaceTools.readCurrentDocument(options.abortSignal ?? abortSignal),
    }),
  }
  const researchSubagent = new ToolLoopAgent({
    model,
    instructions: `你是 Tessera 的只读工作区研究子 Agent。使用工具完成一个边界明确的研究任务，不能修改文件。
完成后输出包含关键结论、可点击 Markdown 文件引用和限制说明的紧凑摘要，供主 Agent 继续工作。`,
    tools: readonlyTools,
    maxOutputTokens: 2_048,
    stopWhen: isStepCount(5),
  })
  const mcpTools = createExternalAgentToolSet(externalTools, abortSignal)
  const tools = {
    ...(runtime.tools ?? {}),
    ...readonlyTools,
    ...createTaskInteractionTools(input.runPolicy.skillId, {
      allowUserInput: !hasRequestedUserInputSinceLastUserMessage(input.messages),
    }),
    "delegate-workspace-research": tool({
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
    }),
    "write-workspace-document": tool({
      description:
        "创建或更新工作区 Markdown 文档。调用会先展示完整候选内容和 Diff，只有用户明确批准后才执行。",
      inputSchema: workspaceDocumentChangeInputSchema,
      needsApproval: true,
      execute: (toolInput, options) =>
        workspaceTools.writeWorkspaceDocument(toolInput, {
          signal: options.abortSignal ?? abortSignal,
          toolCallId: options.toolCallId,
        }),
    }),
    ...mcpTools,
  }
  const agent = createTaskAgent({
    baseInstructions: agentInstructions(workspaceName),
    model,
    ...(onRunMetrics ? { onRunMetrics } : {}),
    ...(runtime.providerOptions ? { providerOptions: runtime.providerOptions } : {}),
    tools,
    toolGroups: {
      external: externalTools.map((externalTool) => externalTool.id),
      workspaceRead: [...Object.keys(readonlyTools), "delegate-workspace-research"],
      workspaceWrite: ["write-workspace-document"],
    },
  })
  type AgentUiMessage = UIMessage<unknown, never, InferUITools<typeof tools>>
  const originalMessages = await toUiMessages<AgentUiMessage>(input.messages, { tools })
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
      firstChunkMs: 30_000,
      chunkMs: 45_000,
    },
    sendReasoning: true,
    sendSources: true,
    onError: (error) => safeErrorMessage(error, input.apiKey),
  })

  for await (const chunk of stream) {
    const sanitized = publicChunk(chunk)
    if (sanitized) yield sanitized
  }
}

export const aiSdkAgentRuntime: AgentRuntime<AiSdkAgentRuntimeRequest, AiChatStreamChunk> = {
  id: "ai-sdk-tool-loop",
  run: runAiSdkAgent,
}

export async function streamAiAgent(
  input: AiChatRuntimeInput,
  { abortSignal, externalTools, onChunk, onRunMetrics, skill, tools, workspaceName }: AiAgentRuntimeOptions,
): Promise<void> {
  for await (const chunk of aiSdkAgentRuntime.run(
    {
      input,
      ...(onRunMetrics ? { onRunMetrics } : {}),
      tools,
      workspaceName,
      ...(externalTools ? { externalTools } : {}),
      ...(skill ? { skill } : {}),
    },
    abortSignal,
  )) {
    await onChunk(chunk)
  }
}
