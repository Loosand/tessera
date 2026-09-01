/**
 * [INPUT]: 主进程注入的 WorkspaceAgentTools、当前工具作用域与运行 AbortSignal
 * [OUTPUT]: AI SDK 使用的 read/edit/write/bash 四核心工具、读取/读写 bash 级别与严格输入 Schema
 * [POS]: 供应商无关工作区文件端口到 AI SDK ToolSet 的窄适配层
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceAgentTools, WorkspaceExecutionAccess } from "@tessera/agent-runtime"
import type { TaskToolScope } from "@tessera/contracts"
import { type ToolSet, tool } from "ai"
import { z } from "zod"

const workspaceContentHashSchema = z.string().regex(/^[a-f\d]{64}$/u)

export const workspaceEditInputSchema = z.strictObject({
  path: z.string().min(1).max(1_024).describe("要编辑的 Markdown 文件相对路径"),
  baseContentHash: workspaceContentHashSchema.describe("最近一次 read 返回的完整文件 contentHash"),
  edits: z
    .array(
      z.strictObject({
        oldText: z.string().min(1).max(262_144).describe("在原始文件中精确且唯一匹配的文本"),
        newText: z.string().max(262_144).describe("替换文本"),
      }),
    )
    .min(1)
    .max(64)
    .describe("基于同一原始文件版本定位且互不重叠的精确编辑"),
})

export const workspaceWriteInputSchema = z
  .strictObject({
    operation: z.enum(["create", "update"]).describe("创建新文件或完整更新已有文件"),
    path: z.string().min(1).max(1_024).describe("要写入的 Markdown 文件相对路径"),
    content: z.string().max(262_144).describe("完整 Markdown 内容"),
    baseContentHash: workspaceContentHashSchema
      .optional()
      .describe("更新已有文件时必填：最近一次 read 返回的完整文件 contentHash"),
  })
  .superRefine((input, context) => {
    if (input.operation === "update" && input.baseContentHash === undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseContentHash"],
        message: "更新已有文件必须提供 baseContentHash",
      })
    }
    if (input.operation === "create" && input.baseContentHash !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseContentHash"],
        message: "创建新文件时不得提供 baseContentHash",
      })
    }
  })

export const workspaceBashInputSchema = z.strictObject({
  command: z.string().min(1).max(32_768).describe("要在当前工作区前台执行的 shell 命令"),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .optional()
    .describe("可选超时，默认 30000ms，最长 120000ms"),
})

export type WorkspaceAiToolSet = Readonly<{
  readTools: ToolSet
  writeTools: ToolSet
}>

export function workspaceBashAccess(toolScope: TaskToolScope): WorkspaceExecutionAccess {
  return toolScope === "workspace-write" ? "read-write" : "read-only"
}

export function createWorkspaceAiToolSet(
  workspaceTools: WorkspaceAgentTools,
  abortSignal: AbortSignal,
  toolScope: TaskToolScope,
): WorkspaceAiToolSet {
  const bashAccess = workspaceBashAccess(toolScope)
  const bashTool = workspaceTools.bash
  return {
    readTools: {
      ...(bashTool
        ? {
            bash: tool({
              description:
                bashAccess === "read-write"
                  ? "在无网络、无宿主 Secret、只能读写当前工作区的前台 shell 中执行命令。用于 ls/rg/find、测试和必要的工作区操作；不启动后台服务。"
                  : "在无网络、无宿主 Secret、工作区只读的前台 shell 中执行命令。用于 ls/rg/find 和其他读取型检查；不启动后台服务。",
              inputSchema: workspaceBashInputSchema,
              execute: (input, options) => bashTool(input, bashAccess, options.abortSignal ?? abortSignal),
            }),
          }
        : {}),
      read: tool({
        description:
          "分页读取一个工作区内 Markdown 文件。路径必须是工作区相对路径；结果截断时使用 truncation.nextOffset 继续，超长单行还要同时传回 truncation.nextLineByteOffset。完整重写前必须在当前运行中读完同一版本的所有分页。",
        inputSchema: z.strictObject({
          path: z.string().min(1).max(1_024).describe("要读取的 Markdown 文件相对路径"),
          offset: z.number().int().min(1).optional().describe("从 1 开始的起始行；省略表示第一行"),
          lineByteOffset: z
            .number()
            .int()
            .min(0)
            .max(262_144)
            .optional()
            .describe("仅续读超长单行时传入 read 返回的 nextLineByteOffset"),
          limit: z.number().int().min(1).max(1_000).optional().describe("本次最多返回的行数"),
        }),
        execute: (input, options) => workspaceTools.read(input, options.abortSignal ?? abortSignal),
      }),
    },
    writeTools: {
      edit: tool({
        description:
          "对已有 Markdown 文件执行一组精确、唯一且互不重叠的局部替换。所有 edits 基于同一原始版本定位；修改前必须先 read 并传入 contentHash。",
        inputSchema: workspaceEditInputSchema,
        execute: (input, options) => workspaceTools.edit(input, options.abortSignal ?? abortSignal),
      }),
      write: tool({
        description:
          "创建新的 Markdown 文件，或在当前运行已经 read 完同一版本所有分页且 contentHash 仍匹配时完整更新已有文件。局部修改优先 edit；create 不会覆盖已有目标。",
        inputSchema: workspaceWriteInputSchema,
        execute: (input, options) => workspaceTools.write(input, options.abortSignal ?? abortSignal),
      }),
    },
  }
}
