/**
 * [INPUT]: Tessera 对工作区索引、AI 供应商配置、Agent 会话和权限审计的持久化需求
 * [OUTPUT]: Drizzle SQLite 表、索引和可推导行类型（AI Key 仅保存 safeStorage 密文）
 * [POS]: 数据库结构的类型事实源；不保存 Markdown 正文
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

const createdAt = integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`)

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    rootPath: text("root_path").notNull(),
    displayName: text("display_name").notNull(),
    createdAt,
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("workspaces_root_path_unique").on(table.rootPath)],
)

export const documentIndex = sqliteTable(
  "document_index",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceModifiedAt: integer("source_modified_at", { mode: "timestamp_ms" }).notNull(),
    indexedAt: integer("indexed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("document_index_workspace_path_unique").on(table.workspaceId, table.relativePath),
    index("document_index_workspace_idx").on(table.workspaceId),
  ],
)

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["idle", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("idle"),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("agent_sessions_workspace_updated_idx").on(table.workspaceId, table.updatedAt)],
)

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("agent_events_session_sequence_unique").on(table.sessionId, table.sequence)],
)

export const permissionDecisions = sqliteTable(
  "permission_decisions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    effect: text("effect", { enum: ["allow", "ask", "deny"] }).notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    createdAt,
  },
  (table) => [index("permission_decisions_session_created_idx").on(table.sessionId, table.createdAt)],
)

export const aiProviderConfigs = sqliteTable("ai_provider_configs", {
  providerId: text("provider_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  baseUrl: text("base_url").notNull(),
  modelsJson: text("models_json").notNull().default("[]"),
  apiKeyCiphertext: text("api_key_ciphertext"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type IndexedDocument = typeof documentIndex.$inferSelect
export type AgentSession = typeof agentSessions.$inferSelect
export type AgentEventRecord = typeof agentEvents.$inferSelect
export type PermissionDecision = typeof permissionDecisions.$inferSelect
export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect
export type NewAiProviderConfigRecord = typeof aiProviderConfigs.$inferInsert
