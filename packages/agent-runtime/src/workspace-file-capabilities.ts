/**
 * [INPUT]: Agent 对已授权工作区文件的列表、读取、搜索与文档变更请求
 * [OUTPUT]: 与模型供应商、AI SDK 和桌面平台无关的类型化工作区文件能力端口
 * [POS]: Agent Kernel 与主进程文件系统适配器之间的稳定 capability contract
 * [DOC]: docs/architecture/agent-file-capabilities.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type ListWorkspaceFilesInput = Readonly<{
  directory?: string | undefined
}>

export type WorkspaceFileSummary = Readonly<{
  modifiedAt: number
  path: string
  size: number
}>

export type ListWorkspaceFilesResult = Readonly<{
  files: readonly WorkspaceFileSummary[]
  limit: number
  truncated: boolean
}>

export type ReadWorkspaceFileInput = Readonly<{
  /** 从 1 开始的行号；省略表示从第一行读取。 */
  offset?: number | undefined
  /** 本次最多返回的行数；主进程仍会施加独立字节上限。 */
  limit?: number | undefined
  path: string
}>

export type WorkspaceFileReadResult = Readonly<{
  content: string
  contentHash: string
  modifiedAt: number
  path: string
  range: Readonly<{
    endLine: number
    startLine: number
    totalLines: number
  }>
  size: number
  truncation: Readonly<{
    lineTruncated: boolean
    maxBytes: number
    nextOffset: number | null
    reason: "bytes" | "lines" | null
    truncated: boolean
  }>
}>

export type CurrentWorkspaceDocumentResult =
  | Readonly<{
      available: false
      reason: string
    }>
  | (WorkspaceFileReadResult & Readonly<{ available: true }>)

export type SearchWorkspaceTextInput = Readonly<{
  directory?: string | undefined
  query: string
}>

export type WorkspaceTextMatch = Readonly<{
  line: number
  path: string
  text: string
}>

export type SearchWorkspaceTextResult = Readonly<{
  matches: readonly WorkspaceTextMatch[]
  query: string
  resultLimit: number
  scannedBytes: number
  skippedFiles: readonly string[]
  truncated: boolean
}>

export type WorkspaceDocumentChangeInput = Readonly<{
  baseContentHash?: string | undefined
  baseModifiedAt?: number | undefined
  content: string
  operation: "create" | "update"
  path: string
  reason: string
}>

export type WorkspaceDocumentWriteResult =
  | Readonly<{
      contentHash: string
      modifiedAt: number
      operation: "create" | "update"
      path: string
      status: "saved"
    }>
  | Readonly<{
      message: string
      path: string
      status: "conflict"
    }>

export type WorkspaceAgentToolExecutionContext = Readonly<{
  signal: AbortSignal
  toolCallId: string
}>

export type ReadonlyWorkspaceAgentTools = Readonly<{
  listWorkspaceFiles(input: ListWorkspaceFilesInput, signal: AbortSignal): Promise<ListWorkspaceFilesResult>
  readCurrentDocument(signal: AbortSignal): Promise<CurrentWorkspaceDocumentResult>
  readWorkspaceFile(input: ReadWorkspaceFileInput, signal: AbortSignal): Promise<WorkspaceFileReadResult>
  searchWorkspaceText(
    input: SearchWorkspaceTextInput,
    signal: AbortSignal,
  ): Promise<SearchWorkspaceTextResult>
}>

export type WorkspaceAgentTools = ReadonlyWorkspaceAgentTools &
  Readonly<{
    writeWorkspaceDocument(
      input: WorkspaceDocumentChangeInput,
      context: WorkspaceAgentToolExecutionContext,
    ): Promise<WorkspaceDocumentWriteResult>
  }>
