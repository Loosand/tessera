/**
 * [INPUT]: Drizzle 数据库实例与工作区元数据
 * [OUTPUT]: 最近工作区查询、可恢复移除，以及不会意外降级托管身份的幂等写入操作
 * [POS]: 工作区持久化的数据库仓储边界
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { desc, eq, isNull } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type Workspace, workspaces } from "./schema"

export type WorkspaceRecordInput = Pick<Workspace, "id" | "rootPath" | "displayName" | "lastOpenedAt"> & {
  readonly contentLibraryId?: Workspace["contentLibraryId"]
  readonly storageKind?: Workspace["storageKind"]
}

export function saveWorkspace(client: DatabaseClient, workspace: WorkspaceRecordInput) {
  const explicitManagedMetadata = {
    ...(workspace.contentLibraryId !== undefined ? { contentLibraryId: workspace.contentLibraryId } : {}),
    ...(workspace.storageKind !== undefined ? { storageKind: workspace.storageKind } : {}),
  }
  client.db
    .insert(workspaces)
    .values({
      ...workspace,
      contentLibraryId: workspace.contentLibraryId ?? null,
      storageKind: workspace.storageKind ?? "external",
    })
    .onConflictDoUpdate({
      target: workspaces.rootPath,
      set: {
        displayName: workspace.displayName,
        lastOpenedAt: workspace.lastOpenedAt,
        hiddenAt: null,
        ...explicitManagedMetadata,
      },
    })
    .run()
}

export function findMostRecentWorkspace(client: DatabaseClient) {
  return (
    client.db
      .select()
      .from(workspaces)
      .where(isNull(workspaces.hiddenAt))
      .orderBy(desc(workspaces.lastOpenedAt))
      .limit(1)
      .get() ?? null
  )
}

export function findWorkspaceById(client: DatabaseClient, id: string) {
  return client.db.select().from(workspaces).where(eq(workspaces.id, id)).get() ?? null
}

export function findWorkspaceByRootPath(client: DatabaseClient, rootPath: string) {
  return client.db.select().from(workspaces).where(eq(workspaces.rootPath, rootPath)).get() ?? null
}

export function listRecentWorkspaces(client: DatabaseClient, limit = 8) {
  return client.db
    .select()
    .from(workspaces)
    .where(isNull(workspaces.hiddenAt))
    .orderBy(desc(workspaces.lastOpenedAt))
    .limit(limit)
    .all()
}

export function hideRecentWorkspace(client: DatabaseClient, id: string) {
  const result = client.db.update(workspaces).set({ hiddenAt: new Date() }).where(eq(workspaces.id, id)).run()
  return result.changes > 0
}
