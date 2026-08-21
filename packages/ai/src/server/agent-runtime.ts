/**
 * [INPUT]: 已解析供应商连接、当前 Skill、客户端交互/研究计划工具、完整 AI SDK UIMessage 历史、主进程注入的受限工作区能力与中止信号
 * [OUTPUT]: 注入当前 Skill instructions、可暂停等待用户并发布研究计划、受步骤/时间/token 边界约束且使用标准 toolApproval 的 AI SDK ToolLoopAgent 增量流
 * [POS]: @tessera/ai/server 中可读并可经人工批准修改 Markdown 的工作区 Agent 编排边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentRuntime } from "@tessera/agent-runtime"
import type { AiChatStreamChunk } from "@tessera/contracts"
import { ToolLoopAgent, createAgentUIStream, isStepCount, tool } from "ai"
import type { InferUITools, UIMessage } from "ai"
import { z } from "zod"
import { createAiSdkLanguageModel } from "./ai-sdk-runtime"
import {
  type AiChatRuntimeInput,
  publicChunk,
  reasoningLevel,
  safeErrorMessage,
  toUiMessages,
} from "./chat-runtime"
import { buildTaskSkillInstructions } from "./skill-instructions"
import { createTaskInteractionTools } from "./task-interaction-tools"

const MAX_AGENT_STEPS = 8
const MAX_AGENT_TOTAL_TOKENS = 80_000

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

export type WorkspaceDocumentChangeInput = Readonly<{
  baseContentHash?: string
  baseModifiedAt?: number
  content: string
  operation: "create" | "update"
  path: string
  reason: string
}>

export type WorkspaceAgentTools = ReadonlyWorkspaceAgentTools & {
  readonly writeWorkspaceDocument: (
    input: WorkspaceDocumentChangeInput,
    context: Readonly<{ signal: AbortSignal; toolCallId: string }>,
  ) => Promise<unknown>
}

export type AiAgentRuntimeOptions = Readonly<{
  abortSignal: AbortSignal
  onChunk: (chunk: AiChatStreamChunk) => void | Promise<void>
  tools: WorkspaceAgentTools
  workspaceName: string
}>

export type AiSdkAgentRuntimeRequest = Readonly<{
  input: AiChatRuntimeInput
  tools: WorkspaceAgentTools
  workspaceName: string
}>

function agentInstructions(workspaceName: string, skillInstructions?: string) {
  const instructions = `你是 Tessera 的工作区 Agent，当前授权范围是工作区「${workspaceName}」中的 Markdown 文档。

规则：
1. 需要工作区事实时先调用读取工具，不要猜测文件内容。
2. 回答中的工作区结论使用可点击 Markdown 链接，格式为“[路径:行号](路径#L行号)”；没有行号时使用“[路径](路径)”。
3. 修改已有文档前必须先读取最新内容，并把读取结果中的 modifiedAt 和 contentHash 原样传给写工具；创建文档使用 create 操作。
4. 写工具输入必须是完整候选 Markdown，并简要说明修改理由。写工具只会先请求用户审批；用户批准后才会在下一轮执行。
5. 用户拒绝后不要在没有新要求或实质不同方案时重复提出同一修改。
6. 工具返回冲突时重新读取文件并说明差异，不得覆盖磁盘新版本。
7. 跨越很多文件、会明显挤占主对话上下文的独立研究可以委派给只读研究子 Agent；简单问题直接使用读取工具。
8. 不能删除、重命名、运行 Shell 或扩大访问范围；工具返回截断或限制信息时明确说明。`
  return skillInstructions ? `${instructions}\n\n${skillInstructions}` : instructions
}

async function* runAiSdkAgent(
  { input, tools: workspaceTools, workspaceName }: AiSdkAgentRuntimeRequest,
  abortSignal: AbortSignal,
): AsyncIterable<AiChatStreamChunk> {
  const model = createAiSdkLanguageModel(input)
  const skillInstructions = await buildTaskSkillInstructions(input.skillId)
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
  const tools = {
    ...readonlyTools,
    ...createTaskInteractionTools(input.skillId),
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
      inputSchema: z.discriminatedUnion("operation", [
        z.strictObject({
          operation: z.literal("create"),
          path: z.string().min(1).max(1_024).describe("要创建的 Markdown 文件相对路径"),
          content: z.string().max(262_144).describe("完整候选 Markdown 内容"),
          reason: z.string().min(1).max(2_000).describe("本次修改的简短理由"),
        }),
        z.strictObject({
          operation: z.literal("update"),
          path: z.string().min(1).max(1_024).describe("要更新的 Markdown 文件相对路径"),
          content: z.string().max(262_144).describe("完整候选 Markdown 内容"),
          reason: z.string().min(1).max(2_000).describe("本次修改的简短理由"),
          baseModifiedAt: z.number().nonnegative().describe("读取文件时返回的 modifiedAt"),
          baseContentHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .describe("读取文件时返回的 contentHash"),
        }),
      ]),
      execute: (toolInput, options) =>
        workspaceTools.writeWorkspaceDocument(toolInput, {
          signal: options.abortSignal ?? abortSignal,
          toolCallId: options.toolCallId,
        }),
    }),
  }
  const agent = new ToolLoopAgent({
    model,
    instructions: agentInstructions(workspaceName, skillInstructions),
    tools,
    toolApproval: { "write-workspace-document": "user-approval" },
    reasoning: reasoningLevel(input.reasoning),
    maxOutputTokens: 4_096,
    stopWhen: [
      isStepCount(MAX_AGENT_STEPS),
      ({ steps }) =>
        steps.reduce((total, step) => total + (step.usage.totalTokens ?? 0), 0) >= MAX_AGENT_TOTAL_TOKENS,
    ],
  })
  type AgentUiMessage = UIMessage<unknown, never, InferUITools<typeof tools>>
  const originalMessages = await toUiMessages<AgentUiMessage>(input.messages, { tools })
  const stream = await createAgentUIStream({
    agent,
    uiMessages: originalMessages,
    originalMessages,
    abortSignal,
    timeout: { totalMs: 120_000, firstChunkMs: 30_000, chunkMs: 45_000 },
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
  { abortSignal, onChunk, tools, workspaceName }: AiAgentRuntimeOptions,
): Promise<void> {
  for await (const chunk of aiSdkAgentRuntime.run({ input, tools, workspaceName }, abortSignal)) {
    await onChunk(chunk)
  }
}
