/**
 * [INPUT]: 主进程注入的托管内容库领域能力、中止信号与 AI SDK 工具调用上下文
 * [OUTPUT]: 标准 AI SDK ToolSet：项目/Artifact 查询、正式文档创建、项目创建、检查与安全移动
 * [POS]: 统一 ToolLoopAgent 与本地混合内容领域服务之间的窄适配层
 * [DOC]: docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  CreateDocumentInput,
  CreateProjectInput,
  InspectProjectInput,
  MoveDocumentsInput,
} from "@tessera/contracts"
import { type ToolSet, tool } from "ai"
import { z } from "zod"

type ContentToolContext = Readonly<{ signal: AbortSignal; toolCallId: string }>

export type ContentDomainAgentTools = Readonly<{
  createDocument: (input: CreateDocumentInput, context: ContentToolContext) => Promise<unknown>
  createProject: (input: CreateProjectInput, context: ContentToolContext) => Promise<unknown>
  inspectProject: (input: InspectProjectInput, context: ContentToolContext) => Promise<unknown>
  listArtifacts: (signal: AbortSignal) => Promise<unknown>
  listProjects: (signal: AbortSignal) => Promise<unknown>
  moveDocuments: (input: MoveDocumentsInput, context: ContentToolContext) => Promise<unknown>
}>

export const createManagedDocumentInputSchema = z.strictObject({
  title: z.string().min(1).max(120).describe("正式文档标题，不包含目录或扩展名"),
  content: z.string().min(1).max(262_144).describe("完整 Markdown 正文"),
  reason: z.string().min(1).max(2_000).describe("用户为什么需要这份正式产物"),
  projectId: z.string().min(1).max(128).optional().describe("目标项目 ID；省略时写入未归档"),
})

export const createManagedProjectInputSchema = z.strictObject({
  name: z.string().min(1).max(80).describe("项目的单层可见名称"),
})

export const inspectManagedProjectInputSchema = z.strictObject({
  projectId: z.string().min(1).max(128).describe("先由 list-projects 获得的项目 ID"),
})

export const moveManagedDocumentsInputSchema = z.strictObject({
  documentIds: z.array(z.string().min(1).max(128)).min(1).max(100).describe("要移动的稳定文档 ID"),
  targetProjectId: z.string().min(1).max(128).describe("目标项目 ID"),
})

export function createContentDomainToolSet(contentTools: ContentDomainAgentTools, abortSignal: AbortSignal) {
  return {
    "list-projects": tool({
      description: "列出用户托管内容库中的未归档和独立项目，返回稳定项目 ID，不读取正文。",
      inputSchema: z.strictObject({}),
      execute: (_input, options) => contentTools.listProjects(options.abortSignal ?? abortSignal),
    }),
    "list-task-artifacts": tool({
      description: "列出当前任务已经创建或引用的正式文档 Artifact，返回稳定文档和项目 ID。",
      inputSchema: z.strictObject({}),
      execute: (_input, options) => contentTools.listArtifacts(options.abortSignal ?? abortSignal),
    }),
    "inspect-project": tool({
      description: "检查一个托管项目的 Markdown 文档结构与元数据，不读取正文。",
      inputSchema: inspectManagedProjectInputSchema,
      execute: (input, options) =>
        contentTools.inspectProject(input, {
          signal: options.abortSignal ?? abortSignal,
          toolCallId: options.toolCallId,
        }),
    }),
    "create-document": tool({
      description:
        "把用户明确要求保存或交付的完整 Markdown 内容创建为正式文档 Artifact。省略 projectId 时进入未归档；调用前会请求用户批准。",
      inputSchema: createManagedDocumentInputSchema,
      needsApproval: true,
      execute: (input, options) =>
        contentTools.createDocument(
          {
            title: input.title,
            content: input.content,
            reason: input.reason,
            ...(input.projectId ? { projectId: input.projectId } : {}),
          },
          {
            signal: options.abortSignal ?? abortSignal,
            toolCallId: options.toolCallId,
          },
        ),
    }),
    "create-project": tool({
      description: "在托管内容库内创建独立项目。只在用户明确要求新建独立项目时使用，并先请求批准。",
      inputSchema: createManagedProjectInputSchema,
      needsApproval: true,
      execute: (input, options) =>
        contentTools.createProject(input, {
          signal: options.abortSignal ?? abortSignal,
          toolCallId: options.toolCallId,
        }),
    }),
    "move-documents": tool({
      description:
        "把当前任务的正式文档安全移动到托管项目；必须先用 list-task-artifacts 和 list-projects 获取稳定 ID，并先请求批准。",
      inputSchema: moveManagedDocumentsInputSchema,
      needsApproval: true,
      execute: (input, options) =>
        contentTools.moveDocuments(input, {
          signal: options.abortSignal ?? abortSignal,
          toolCallId: options.toolCallId,
        }),
    }),
  } satisfies ToolSet
}
