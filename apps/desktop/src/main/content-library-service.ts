/**
 * [INPUT]: 用户授权的内容库目录、SQLite 内容控制层、任务/Run 标识与领域工具输入
 * [OUTPUT]: 未归档内容库、托管项目、Markdown Artifact 创建/查询/检查/安全移动及可恢复审计
 * [POS]: Electron 主进程中统一创作 Agent 的混合内容领域边界
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { randomUUID } from "node:crypto"
import { mkdir, readdir, realpath, rename, stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import type {
  ContentLibraryInfo,
  CreateDocumentInput,
  CreateProjectInput,
  DocumentRef,
  MoveDocumentsInput,
  ProjectRef,
  TaskArtifact,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  findActiveContentLibrary,
  findIndexedDocumentById,
  findIndexedDocumentByWorkspacePath,
  findWorkspaceById,
  findWorkspaceByRootPath,
  listManagedWorkspaces,
  listTaskArtifacts as listTaskArtifactRecords,
  moveIndexedDocument,
  revokeContentLibrary,
  saveArtifact,
  saveContentLibrary,
  saveIndexedDocument,
  saveTaskResourceBinding,
  saveWorkspace,
  saveWorkspaceOperation,
} from "@tessera/database"
import {
  isAgentMarkdownPath,
  readAgentMarkdownFile,
  resolveAgentCreatePath,
  resolveAgentPath,
  writeAgentMarkdownFile,
} from "./read-only-agent-tools"

const INBOX_NAME = "未归档"
const MAX_PROJECT_NAME_LENGTH = 80
const MAX_DOCUMENT_TITLE_LENGTH = 120

export class ContentLibraryError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "invalid-input" | "library-unavailable" | "not-found" | "operation-failed",
  ) {
    super(message)
  }
}

type OperationContext = {
  readonly runId: string | null
  readonly taskId: string
}

type CreationContext = OperationContext & {
  readonly runId: string
}

type ManagedWorkspace = NonNullable<ReturnType<typeof findWorkspaceById>>

type ProjectInspection = {
  documents: Array<{ id: string | null; modifiedAt: number; relativePath: string; size: number }>
  project: ProjectRef
  truncated: boolean
}

function normalizeVisibleName(value: string, label: string, maxLength: number) {
  const name = value.trim().normalize("NFC")
  if (
    !name ||
    name.length > maxLength ||
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    /[\\/:]/u.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new ContentLibraryError(`${label}必须是可见的单层名称。`, "invalid-input")
  }
  return name
}

function normalizeProjectName(value: string) {
  const name = normalizeVisibleName(value, "项目名称", MAX_PROJECT_NAME_LENGTH)
  if (name === INBOX_NAME) {
    throw new ContentLibraryError(`「${INBOX_NAME}」是内容库保留目录。`, "invalid-input")
  }
  return name
}

function normalizeDocumentTitle(value: string) {
  const withoutMarkdownExtension = value.trim().replace(/\.(?:md|markdown)$/iu, "")
  return normalizeVisibleName(withoutMarkdownExtension, "文档标题", MAX_DOCUMENT_TITLE_LENGTH)
}

function toProject(workspace: ManagedWorkspace): ProjectRef {
  return { id: workspace.id, name: workspace.displayName }
}

function titleFromRelativePath(relativePath: string) {
  const name = basename(relativePath)
  return name.slice(0, Math.max(0, name.length - extname(name).length))
}

function serialize(value: unknown) {
  return JSON.stringify(value)
}

export type ContentLibraryService = ReturnType<typeof createContentLibraryService>

export function createContentLibraryService(client: DatabaseClient) {
  function requireActiveLibrary() {
    const library = findActiveContentLibrary(client)
    if (!library) {
      throw new ContentLibraryError("请先在设置中选择托管内容库目录。", "library-unavailable")
    }
    return library
  }

  function requireManagedWorkspace(projectId: string, libraryId?: string) {
    const workspace = findWorkspaceById(client, projectId)
    if (
      !workspace ||
      workspace.storageKind === "external" ||
      (libraryId && workspace.contentLibraryId !== libraryId)
    ) {
      throw new ContentLibraryError("找不到指定的托管项目。", "not-found")
    }
    return workspace
  }

  function toLibraryInfo(library = requireActiveLibrary()): ContentLibraryInfo {
    const inbox = listManagedWorkspaces(client, library.id).find(
      (workspace) => workspace.storageKind === "managed-inbox",
    )
    if (!inbox) {
      throw new ContentLibraryError("内容库缺少未归档目录，请重新选择内容库。", "library-unavailable")
    }
    return {
      id: library.id,
      name: library.displayName,
      rootPath: library.rootPath,
      inbox: toProject(inbox),
    }
  }

  function recordOperation(
    context: OperationContext,
    operation: "create-document" | "create-project" | "inspect-project" | "move-documents",
    status: "applied" | "conflict" | "failed",
    parameters: unknown,
    result: unknown,
    recovery: unknown = null,
    errorMessage: string | null = null,
  ) {
    const now = new Date()
    return saveWorkspaceOperation(client, {
      id: randomUUID(),
      taskId: context.taskId,
      runId: context.runId,
      operation,
      status,
      parametersJson: serialize(parameters),
      resultJson: result === null ? null : serialize(result),
      recoveryJson: recovery === null ? null : serialize(recovery),
      errorMessage,
      completedAt: now,
    })
  }

  async function configure(rootPath: string) {
    const canonicalRoot = await realpath(rootPath).catch(() => {
      throw new ContentLibraryError("选择的内容库目录不可访问。", "library-unavailable")
    })
    const metadata = await stat(canonicalRoot)
    if (!metadata.isDirectory()) {
      throw new ContentLibraryError("内容库必须是一个目录。", "invalid-input")
    }

    const now = new Date()
    const existingLibrary = findActiveContentLibrary(client)
    const savedLibrary = saveContentLibrary(client, {
      id: existingLibrary?.rootPath === canonicalRoot ? existingLibrary.id : randomUUID(),
      rootPath: canonicalRoot,
      displayName: basename(canonicalRoot),
      updatedAt: now,
    })
    if (!savedLibrary) throw new ContentLibraryError("无法保存内容库设置。", "operation-failed")
    if (existingLibrary && existingLibrary.id !== savedLibrary.id) {
      revokeContentLibrary(client, existingLibrary.id)
    }

    const inboxRoot = join(canonicalRoot, INBOX_NAME)
    await mkdir(inboxRoot, { recursive: true })
    const canonicalInboxRoot = await realpath(inboxRoot)
    const existingInbox = findWorkspaceByRootPath(client, canonicalInboxRoot)
    saveWorkspace(client, {
      id: existingInbox?.id ?? randomUUID(),
      rootPath: canonicalInboxRoot,
      displayName: INBOX_NAME,
      lastOpenedAt: now,
      storageKind: "managed-inbox",
      contentLibraryId: savedLibrary.id,
    })
    return toLibraryInfo(savedLibrary)
  }

  async function createProject(context: OperationContext, input: CreateProjectInput) {
    const library = requireActiveLibrary()
    const name = normalizeProjectName(input.name)
    const projectRoot = join(library.rootPath, name)
    const existingWorkspace = findWorkspaceByRootPath(client, projectRoot)
    const exists = await stat(projectRoot).then(
      () => true,
      () => false,
    )
    if (exists || existingWorkspace) {
      recordOperation(context, "create-project", "conflict", { name }, null)
      throw new ContentLibraryError(`内容库内已经存在「${name}」。`, "conflict")
    }

    try {
      await mkdir(projectRoot)
      const canonicalProjectRoot = await realpath(projectRoot)
      const now = new Date()
      const projectId = randomUUID()
      saveWorkspace(client, {
        id: projectId,
        rootPath: canonicalProjectRoot,
        displayName: name,
        lastOpenedAt: now,
        storageKind: "managed-project",
        contentLibraryId: library.id,
      })
      const project = toProject(requireManagedWorkspace(projectId, library.id))
      saveTaskResourceBinding(client, {
        id: randomUUID(),
        taskId: context.taskId,
        runId: context.runId,
        resourceType: "project",
        resourceId: projectId,
        role: "scope",
      })
      recordOperation(context, "create-project", "applied", { name }, { projectId })
      return project
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建项目失败。"
      recordOperation(context, "create-project", "failed", { name }, null, null, message)
      if (error instanceof ContentLibraryError) throw error
      throw new ContentLibraryError(message, "operation-failed")
    }
  }

  async function createDocument(context: CreationContext, input: CreateDocumentInput) {
    const library = requireActiveLibrary()
    const project = input.projectId
      ? requireManagedWorkspace(input.projectId, library.id)
      : listManagedWorkspaces(client, library.id).find(
          (workspace) => workspace.storageKind === "managed-inbox",
        )
    if (!project) {
      throw new ContentLibraryError("内容库缺少未归档目录。", "library-unavailable")
    }
    const title = normalizeDocumentTitle(input.title)
    const relativePath = `${title}.md`

    try {
      const snapshot = await writeAgentMarkdownFile(project.rootPath, relativePath, input.content, "create")
      const now = new Date()
      const indexedDocument = saveIndexedDocument(client, {
        id: randomUUID(),
        workspaceId: project.id,
        relativePath: snapshot.path,
        contentHash: snapshot.contentHash,
        sourceModifiedAt: new Date(snapshot.modifiedAt),
        indexedAt: now,
      })
      if (!indexedDocument) {
        throw new ContentLibraryError("无法保存正式文档索引。", "operation-failed")
      }
      const documentId = indexedDocument.id
      const artifact = saveArtifact(client, {
        id: randomUUID(),
        taskId: context.taskId,
        runId: context.runId,
        documentId,
        relation: "created",
        updatedAt: now,
      })
      saveTaskResourceBinding(client, {
        id: randomUUID(),
        taskId: context.taskId,
        runId: context.runId,
        resourceType: "document",
        resourceId: documentId,
        role: "output",
      })
      saveTaskResourceBinding(client, {
        id: randomUUID(),
        taskId: context.taskId,
        runId: context.runId,
        resourceType: "project",
        resourceId: project.id,
        role: "scope",
      })
      recordOperation(
        context,
        "create-document",
        "applied",
        { projectId: project.id, reason: input.reason, title },
        { documentId, relativePath },
      )
      if (!artifact) throw new ContentLibraryError("无法保存 Artifact 关系。", "operation-failed")
      return hydrateArtifact(artifact)
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建文档失败。"
      const status = message.includes("已经存在") ? "conflict" : "failed"
      recordOperation(
        context,
        "create-document",
        status,
        { projectId: project.id, reason: input.reason, title },
        null,
        null,
        message,
      )
      throw new ContentLibraryError(message, status === "conflict" ? "conflict" : "operation-failed")
    }
  }

  function hydrateArtifact(record: ReturnType<typeof listTaskArtifactRecords>[number]): TaskArtifact {
    const document = findIndexedDocumentById(client, record.documentId)
    if (!document) throw new ContentLibraryError("Artifact 对应的文档索引不存在。", "not-found")
    const workspace = findWorkspaceById(client, document.workspaceId)
    if (!workspace) throw new ContentLibraryError("Artifact 对应的项目不存在。", "not-found")
    const documentRef: DocumentRef = {
      id: document.id,
      mediaType: "text/markdown",
      projectId: workspace.id,
      title: titleFromRelativePath(document.relativePath),
    }
    return {
      id: record.id,
      taskId: record.taskId,
      runId: record.runId,
      documentId: record.documentId,
      relation: record.relation,
      document: documentRef,
      project: toProject(workspace),
      relativePath: document.relativePath,
      updatedAt: record.updatedAt.getTime(),
    }
  }

  async function inspectProject(context: OperationContext, projectId: string): Promise<ProjectInspection> {
    const library = requireActiveLibrary()
    const project = requireManagedWorkspace(projectId, library.id)
    const entries = await readdir(project.rootPath, { withFileTypes: true })
    const documents: ProjectInspection["documents"] = []
    let truncated = false
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
      if (entry.name.startsWith(".") || !entry.isFile() || !isAgentMarkdownPath(entry.name)) continue
      if (documents.length >= 200) {
        truncated = true
        break
      }
      const snapshot = await readAgentMarkdownFile(project.rootPath, entry.name, new AbortController().signal)
      const indexed = findIndexedDocumentByWorkspacePath(client, project.id, snapshot.path)
      documents.push({
        id: indexed?.id ?? null,
        relativePath: snapshot.path,
        size: snapshot.size,
        modifiedAt: snapshot.modifiedAt,
      })
    }
    const result = { project: toProject(project), documents, truncated }
    recordOperation(context, "inspect-project", "applied", { projectId }, { count: documents.length })
    return result
  }

  async function moveDocuments(context: OperationContext, input: MoveDocumentsInput) {
    const library = requireActiveLibrary()
    const targetProject = requireManagedWorkspace(input.targetProjectId, library.id)
    const documentIds = [...new Set(input.documentIds)]
    if (documentIds.length === 0 || documentIds.length > 100) {
      throw new ContentLibraryError("一次必须移动 1 到 100 篇文档。", "invalid-input")
    }

    const planMoves = () =>
      Promise.all(
        documentIds.map(async (documentId) => {
          const document = findIndexedDocumentById(client, documentId)
          if (!document) throw new ContentLibraryError(`找不到文档 ${documentId}。`, "not-found")
          const sourceProject = requireManagedWorkspace(document.workspaceId, library.id)
          if (sourceProject.id === targetProject.id) {
            throw new ContentLibraryError(`文档「${document.relativePath}」已经在目标项目中。`, "conflict")
          }
          const source = await resolveAgentPath(sourceProject.rootPath, document.relativePath)
          const target = await resolveAgentCreatePath(targetProject.rootPath, basename(document.relativePath))
          return { document, sourceProject, source, target }
        }),
      )

    let planned: Awaited<ReturnType<typeof planMoves>>
    try {
      planned = await planMoves()
      const targetPaths = new Set(planned.map((item) => item.target.relativePath))
      if (targetPaths.size !== planned.length) {
        throw new ContentLibraryError("待移动文档中存在同名文件，无法安全移动。", "conflict")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法预检待移动文档。"
      const code =
        error instanceof ContentLibraryError
          ? error.code
          : message.includes("已经存在")
            ? "conflict"
            : "operation-failed"
      recordOperation(
        context,
        "move-documents",
        code === "conflict" ? "conflict" : "failed",
        { documentIds, targetProjectId: targetProject.id },
        null,
        null,
        message,
      )
      throw error instanceof ContentLibraryError ? error : new ContentLibraryError(message, code)
    }

    const moved: typeof planned = []
    try {
      for (const item of planned) {
        await rename(item.source.absolutePath, item.target.absolutePath)
        moved.push(item)
      }
      const movedSnapshots = await Promise.all(
        moved.map(async (item) => ({
          item,
          snapshot: await readAgentMarkdownFile(
            targetProject.rootPath,
            item.target.relativePath,
            new AbortController().signal,
          ),
        })),
      )
      client.connection.transaction(() => {
        const indexedAt = new Date()
        for (const { item, snapshot } of movedSnapshots) {
          moveIndexedDocument(client, item.document.id, {
            workspaceId: targetProject.id,
            relativePath: item.target.relativePath,
            contentHash: snapshot.contentHash,
            sourceModifiedAt: new Date(snapshot.modifiedAt),
            indexedAt,
          })
        }
        saveTaskResourceBinding(client, {
          id: randomUUID(),
          taskId: context.taskId,
          runId: context.runId,
          resourceType: "project",
          resourceId: targetProject.id,
          role: "scope",
        })
        recordOperation(
          context,
          "move-documents",
          "applied",
          { documentIds, targetProjectId: targetProject.id },
          { moved: moved.map((item) => item.document.id) },
          {
            reverse: moved.map((item) => ({
              documentId: item.document.id,
              projectId: item.sourceProject.id,
              relativePath: item.source.relativePath,
            })),
          },
        )
      })()
      return {
        documents: documentIds.map((documentId) => {
          const artifact = listTaskArtifactRecords(client, context.taskId).find(
            (candidate) => candidate.documentId === documentId,
          )
          return artifact ? hydrateArtifact(artifact) : null
        }),
        project: toProject(targetProject),
      }
    } catch (error) {
      let rollbackFailed = false
      for (const item of [...moved].reverse()) {
        try {
          await rename(item.target.absolutePath, item.source.absolutePath)
        } catch {
          rollbackFailed = true
        }
      }
      const message = error instanceof Error ? error.message : "移动文档失败。"
      recordOperation(
        context,
        "move-documents",
        "failed",
        { documentIds, targetProjectId: targetProject.id },
        null,
        { rollbackFailed },
        message,
      )
      throw new ContentLibraryError(
        rollbackFailed ? `${message} 部分文件未能自动恢复，请查看操作日志。` : message,
        "operation-failed",
      )
    }
  }

  return {
    configure,
    current: () => {
      const library = findActiveContentLibrary(client)
      return library ? toLibraryInfo(library) : null
    },
    revoke: () => {
      const library = findActiveContentLibrary(client)
      if (!library) return null
      revokeContentLibrary(client, library.id)
      return null
    },
    listProjects: () => {
      const library = requireActiveLibrary()
      return listManagedWorkspaces(client, library.id).map(toProject)
    },
    listArtifacts: (taskId: string) =>
      listTaskArtifactRecords(client, taskId).flatMap((record) => {
        try {
          return [hydrateArtifact(record)]
        } catch {
          return []
        }
      }),
    createDocument,
    createProject,
    inspectProject,
    moveDocuments,
  }
}
