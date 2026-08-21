/**
 * [INPUT]: Tessera 对工作区索引、通用任务会话、AI 供应商配置、Agent 运行检查点、变更审批和权限审计的持久化需求
 * [OUTPUT]: Drizzle SQLite 表、索引和可推导行类型，包括可恢复的任务等待输入标记（AI Key 仅保存 safeStorage 密文）
 * [POS]: 数据库结构的类型事实源；不保存 Markdown 正文
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

const createdAt = integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`)

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    rootPath: text("root_path").notNull(),
    displayName: text("display_name").notNull(),
    createdAt,
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }).notNull(),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
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
    waitingForInput: integer("waiting_for_input", { mode: "boolean" }).notNull().default(false),
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

export const taskSessions = sqliteTable(
  "task_sessions",
  {
    id: text("id").primaryKey(),
    mode: text("mode", { enum: ["chat", "agent"] })
      .notNull()
      .default("chat"),
    skillId: text("skill_id", { enum: ["research", "writing"] }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["idle", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("idle"),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "task_sessions_agent_workspace_check",
      sql`${table.mode} = 'chat' OR ${table.workspaceId} IS NOT NULL`,
    ),
    index("task_sessions_updated_idx").on(table.updatedAt),
    index("task_sessions_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
  ],
)

export const taskMessages = sqliteTable(
  "task_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("task_messages_task_sequence_unique").on(table.taskId, table.sequence),
    index("task_messages_task_idx").on(table.taskId),
  ],
)

export const taskRuns = sqliteTable(
  "task_runs",
  {
    requestId: text("request_id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    configId: text("config_id").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "cancelled", "interrupted"],
    }).notNull(),
    lastSequence: integer("last_sequence").notNull().default(0),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("task_runs_task_updated_idx").on(table.taskId, table.updatedAt)],
)

export const taskRunEvents = sqliteTable(
  "task_run_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => taskRuns.requestId, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("task_run_events_request_sequence_unique").on(table.requestId, table.sequence)],
)

export const agentChangeProposals = sqliteTable(
  "agent_change_proposals",
  {
    approvalId: text("approval_id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => taskRuns.requestId, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    operation: text("operation", { enum: ["create", "update"] }).notNull(),
    relativePath: text("relative_path").notNull(),
    reason: text("reason").notNull(),
    baseContent: text("base_content"),
    baseModifiedAt: integer("base_modified_at", { mode: "timestamp_ms" }),
    baseContentHash: text("base_content_hash"),
    proposedContent: text("proposed_content").notNull(),
    proposedContentHash: text("proposed_content_hash").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "applied", "conflict", "failed"],
    }).notNull(),
    decisionReason: text("decision_reason"),
    errorMessage: text("error_message"),
    createdAt,
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("agent_change_proposals_task_tool_unique").on(table.taskId, table.toolCallId),
    index("agent_change_proposals_task_created_idx").on(table.taskId, table.createdAt),
  ],
)

export const aiProviderConfigs = sqliteTable(
  "ai_provider_configs",
  {
    configId: text("config_id").primaryKey(),
    providerId: text("provider_id").notNull(),
    displayName: text("display_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    baseUrl: text("base_url").notNull(),
    modelsJson: text("models_json").notNull().default("[]"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ai_provider_configs_provider_idx").on(table.providerId)],
)

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type IndexedDocument = typeof documentIndex.$inferSelect
export type AgentSession = typeof agentSessions.$inferSelect
export type AgentEventRecord = typeof agentEvents.$inferSelect
export type PermissionDecision = typeof permissionDecisions.$inferSelect
export type TaskSession = typeof taskSessions.$inferSelect
export type TaskMessageRecord = typeof taskMessages.$inferSelect
export type TaskRun = typeof taskRuns.$inferSelect
export type TaskRunEventRecord = typeof taskRunEvents.$inferSelect
export type AgentChangeProposal = typeof agentChangeProposals.$inferSelect
export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect
export type NewAiProviderConfigRecord = typeof aiProviderConfigs.$inferInsert
