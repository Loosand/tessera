/**
 * [INPUT]: SQLite 数据库实例与内容库、文档索引、动态资源、Artifact、项目操作记录
 * [OUTPUT]: 不包含 Markdown 正文的统一内容控制层幂等读写与任务当前项目更新
 * [POS]: 混合内容库适配器和后续存储适配器共用的数据库仓储边界
 * [DOC]: docs/architecture/database.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { and, asc, desc, eq, isNull } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import {
  type ArtifactRecord,
  type ContentLibrary,
  type IndexedDocument,
  type TaskResourceBindingRecord,
  type WorkspaceOperationRecord,
  artifacts,
  contentLibraries,
  documentIndex,
  taskResourceBindings,
  taskSessions,
  workspaceOperations,
  workspaces,
} from "./schema"

export type ContentLibraryRecordInput = Pick<ContentLibrary, "id" | "rootPath" | "displayName" | "updatedAt">

export type IndexedDocumentRecordInput = Pick<
  IndexedDocument,
  "id" | "workspaceId" | "relativePath" | "contentHash" | "sourceModifiedAt" | "indexedAt"
>

export type TaskResourceBindingRecordInput = Pick<
  TaskResourceBindingRecord,
  "id" | "taskId" | "runId" | "resourceType" | "resourceId" | "role"
>

export type ArtifactRecordInput = Pick<
  ArtifactRecord,
  "id" | "taskId" | "runId" | "documentId" | "relation" | "updatedAt"
>

export type WorkspaceOperationRecordInput = Pick<
  WorkspaceOperationRecord,
  | "id"
  | "taskId"
  | "runId"
  | "operation"
  | "status"
  | "parametersJson"
  | "resultJson"
  | "recoveryJson"
  | "errorMessage"
  | "completedAt"
>

export function saveContentLibrary(client: DatabaseClient, input: ContentLibraryRecordInput) {
  client.db
    .insert(contentLibraries)
    .values({ ...input, revokedAt: null })
    .onConflictDoUpdate({
      target: contentLibraries.rootPath,
      set: {
        displayName: input.displayName,
        updatedAt: input.updatedAt,
        revokedAt: null,
      },
    })
    .run()
  return findContentLibraryByRootPath(client, input.rootPath)
}

export function findActiveContentLibrary(client: DatabaseClient) {
  return (
    client.db
      .select()
      .from(contentLibraries)
      .where(isNull(contentLibraries.revokedAt))
      .orderBy(desc(contentLibraries.updatedAt))
      .limit(1)
      .get() ?? null
  )
}

export function findContentLibraryById(client: DatabaseClient, id: string) {
  return client.db.select().from(contentLibraries).where(eq(contentLibraries.id, id)).get() ?? null
}

export function findContentLibraryByRootPath(client: DatabaseClient, rootPath: string) {
  return (
    client.db.select().from(contentLibraries).where(eq(contentLibraries.rootPath, rootPath)).get() ?? null
  )
}

export function revokeContentLibrary(client: DatabaseClient, id: string) {
  const now = new Date()
  return (
    client.db
      .update(contentLibraries)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(contentLibraries.id, id))
      .run().changes > 0
  )
}

export function listManagedWorkspaces(client: DatabaseClient, contentLibraryId: string) {
  return client.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.contentLibraryId, contentLibraryId))
    .orderBy(asc(workspaces.createdAt))
    .all()
}

export function saveIndexedDocument(client: DatabaseClient, input: IndexedDocumentRecordInput) {
  client.db
    .insert(documentIndex)
    .values(input)
    .onConflictDoUpdate({
      target: [documentIndex.workspaceId, documentIndex.relativePath],
      set: {
        contentHash: input.contentHash,
        sourceModifiedAt: input.sourceModifiedAt,
        indexedAt: input.indexedAt,
      },
    })
    .run()
  return findIndexedDocumentByWorkspacePath(client, input.workspaceId, input.relativePath)
}

export function findIndexedDocumentById(client: DatabaseClient, id: string) {
  return client.db.select().from(documentIndex).where(eq(documentIndex.id, id)).get() ?? null
}

export function findIndexedDocumentByWorkspacePath(
  client: DatabaseClient,
  workspaceId: string,
  relativePath: string,
) {
  return (
    client.db
      .select()
      .from(documentIndex)
      .where(and(eq(documentIndex.workspaceId, workspaceId), eq(documentIndex.relativePath, relativePath)))
      .get() ?? null
  )
}

export function moveIndexedDocument(
  client: DatabaseClient,
  documentId: string,
  input: Pick<
    IndexedDocument,
    "workspaceId" | "relativePath" | "contentHash" | "sourceModifiedAt" | "indexedAt"
  >,
) {
  const result = client.db.update(documentIndex).set(input).where(eq(documentIndex.id, documentId)).run()
  return result.changes > 0 ? findIndexedDocumentById(client, documentId) : null
}

export function saveTaskResourceBinding(client: DatabaseClient, input: TaskResourceBindingRecordInput) {
  client.db.insert(taskResourceBindings).values(input).onConflictDoNothing().run()
  return (
    client.db.select().from(taskResourceBindings).where(eq(taskResourceBindings.id, input.id)).get() ?? null
  )
}

export function listTaskResourceBindings(client: DatabaseClient, taskId: string) {
  return client.db
    .select()
    .from(taskResourceBindings)
    .where(eq(taskResourceBindings.taskId, taskId))
    .orderBy(asc(taskResourceBindings.createdAt))
    .all()
}

export function saveArtifact(client: DatabaseClient, input: ArtifactRecordInput) {
  client.db
    .insert(artifacts)
    .values({ ...input, status: "active" })
    .onConflictDoUpdate({
      target: [artifacts.runId, artifacts.documentId, artifacts.relation],
      set: { status: "active", updatedAt: input.updatedAt },
    })
    .run()
  return (
    client.db.select().from(artifacts).where(eq(artifacts.id, input.id)).get() ??
    client.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.runId, input.runId),
          eq(artifacts.documentId, input.documentId),
          eq(artifacts.relation, input.relation),
        ),
      )
      .get() ??
    null
  )
}

export function listTaskArtifacts(client: DatabaseClient, taskId: string) {
  return client.db
    .select()
    .from(artifacts)
    .where(eq(artifacts.taskId, taskId))
    .orderBy(asc(artifacts.createdAt))
    .all()
}

export function saveWorkspaceOperation(client: DatabaseClient, input: WorkspaceOperationRecordInput) {
  client.db.insert(workspaceOperations).values(input).onConflictDoNothing().run()
  return (
    client.db.select().from(workspaceOperations).where(eq(workspaceOperations.id, input.id)).get() ?? null
  )
}

export function listWorkspaceOperations(client: DatabaseClient, taskId: string) {
  return client.db
    .select()
    .from(workspaceOperations)
    .where(eq(workspaceOperations.taskId, taskId))
    .orderBy(asc(workspaceOperations.createdAt))
    .all()
}

export function setTaskWorkspace(client: DatabaseClient, taskId: string, workspaceId: string) {
  return (
    client.db
      .update(taskSessions)
      .set({ workspaceId, updatedAt: new Date() })
      .where(eq(taskSessions.id, taskId))
      .run().changes > 0
  )
}
