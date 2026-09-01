/**
 * [INPUT]: Agent 对已授权工作区 Markdown 文件的分页/单行续读、精确编辑、完整写入请求与可选 Bash capability
 * [OUTPUT]: 含 UTF-8 单行分段游标、版本身份且与供应商和桌面平台无关的 read/edit/write/bash 核心能力
 * [POS]: Agent Kernel 与主进程文件系统适配器之间的稳定 capability contract
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceBashAgentTool } from "./execution-environment"

export type ReadWorkspaceFileInput = Readonly<{
  /** 从 1 开始的行号；省略表示从第一行读取。 */
  offset?: number | undefined
  /** 仅用于续读超长单行：从起始行的这个 UTF-8 字节边界继续，省略表示行首。 */
  lineByteOffset?: number | undefined
  /** 本次最多返回的行数；主进程仍会施加独立字节上限。 */
  limit?: number | undefined
  path: string
}>

export type WorkspaceFileEdit = Readonly<{
  /** 必须在原始文件中精确且唯一匹配，多个编辑基于同一原始版本定位。 */
  oldText: string
  newText: string
}>

export type EditWorkspaceFileInput = Readonly<{
  /** 最近一次 read 返回的完整文件内容 hash。 */
  baseContentHash: string
  edits: readonly WorkspaceFileEdit[]
  path: string
}>

export type WriteWorkspaceFileInput = Readonly<{
  /** 更新已有文件时必填；实现端还必须确认当前运行已完整读取该版本。创建时不得传入。 */
  baseContentHash?: string | undefined
  content: string
  operation: "create" | "update"
  path: string
}>

export type WorkspaceFileReadResult = Readonly<{
  content: string
  contentHash: string
  modifiedAt: number
  path: string
  range: Readonly<{
    endLine: number
    /** 只在结果是单行字节分片时存在；endByte 为不包含的 UTF-8 字节位置。 */
    lineByteRange: Readonly<{
      endByte: number
      startByte: number
      totalBytes: number
    }> | null
    startLine: number
    totalLines: number
  }>
  size: number
  truncation: Readonly<{
    lineTruncated: boolean
    maxBytes: number
    /** 超长单行的下一段 UTF-8 字节位置；与 nextOffset 一起传回 read。 */
    nextLineByteOffset: number | null
    nextOffset: number | null
    reason: "bytes" | "lines" | null
    truncated: boolean
  }>
}>

export type WorkspaceFileMutationResult =
  | Readonly<{
      contentHash: string
      modifiedAt: number
      operation: "create" | "edit" | "update"
      path: string
      status: "saved"
    }>
  | Readonly<{
      message: string
      path: string
      status: "conflict"
    }>

/** 新运行使用的 Pi 式文件核心；授权、路径与提交策略由实现端持有。 */
export type CoreWorkspaceAgentTools = Readonly<{
  edit(input: EditWorkspaceFileInput, signal: AbortSignal): Promise<WorkspaceFileMutationResult>
  read(input: ReadWorkspaceFileInput, signal: AbortSignal): Promise<WorkspaceFileReadResult>
  write(input: WriteWorkspaceFileInput, signal: AbortSignal): Promise<WorkspaceFileMutationResult>
}>

export type WorkspaceAgentTools = CoreWorkspaceAgentTools & Partial<WorkspaceBashAgentTool>
