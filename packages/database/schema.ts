/**
 * [INPUT]: Tessera 对内容库/托管工作区、动态资源、Artifact、项目操作、通用任务会话/创作方式、AI 供应商模型事实、MCP 服务器、用户 Skill、完整逐轮执行策略/资源摘要、AI SDK 生命周期指标、Agent 运行检查点、变更审批和权限审计的持久化需求
 * [OUTPUT]: Drizzle SQLite 表、索引和可推导行类型，包括不含 Markdown 正文的统一内容控制层、用户 Skill 安装目录、可恢复任务状态、逐轮 RunPolicy/资源上下文摘要与完成原因/Token/耗时指标（AI Key 与 MCP 凭据仅保存 safeStorage 密文）
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

export const contentLibraries = sqliteTable(
  "content_libraries",
  {
    id: text("id").primaryKey(),
    rootPath: text("root_path").notNull(),
    displayName: text("display_name").notNull(),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("content_libraries_root_path_unique").on(table.rootPath),
    index("content_libraries_updated_idx").on(table.updatedAt),
  ],
)

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    rootPath: text("root_path").notNull(),
    displayName: text("display_name").notNull(),
    createdAt,
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }).notNull(),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }),
    storageKind: text("storage_kind", {
      enum: ["external", "managed-inbox", "managed-project"],
    })
      .notNull()
      .default("external"),
    contentLibraryId: text("content_library_id").references(() => contentLibraries.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("workspaces_root_path_unique").on(table.rootPath),
    index("workspaces_content_library_idx").on(table.contentLibraryId, table.storageKind),
  ],
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

export const taskSessions = sqliteTable(
  "task_sessions",
  {
    id: text("id").primaryKey(),
    mode: text("mode", { enum: ["chat", "agent"] })
      .notNull()
      .default("chat"),
    skillId: text("skill_id"),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
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
    mode: text("mode", { enum: ["chat", "agent"] }),
    skillId: text("skill_id"),
    reasoning: text("reasoning", { enum: ["auto", "none", "low", "medium", "high"] }),
    webSearch: integer("web_search", { mode: "boolean" }),
    policyJson: text("policy_json"),
    resourceSummaryJson: text("resource_summary_json"),
    sdkCallId: text("sdk_call_id"),
    finishReason: text("finish_reason"),
    rawFinishReason: text("raw_finish_reason"),
    inputTokens: integer("input_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    stepCount: integer("step_count"),
    toolCallCount: integer("tool_call_count"),
    timeToFirstOutputMs: integer("time_to_first_output_ms"),
    modelDurationMs: integer("model_duration_ms"),
    toolDurationMs: integer("tool_duration_ms"),
    durationMs: integer("duration_ms"),
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

export const researchRuns = sqliteTable(
  "research_runs",
  {
    requestId: text("request_id")
      .primaryKey()
      .references(() => taskRuns.requestId, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    phase: text("phase", {
      enum: ["preparing", "planning", "discovering", "reading", "verifying", "synthesizing", "completed"],
    }).notNull(),
    outcome: text("outcome", { enum: ["complete", "partial"] }),
    objective: text("objective"),
    scope: text("scope"),
    deliverable: text("deliverable"),
    planVersion: integer("plan_version").notNull().default(0),
    limitationsJson: text("limitations_json").notNull().default("[]"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("research_runs_task_updated_idx").on(table.taskId, table.updatedAt)],
)

export const researchQuestions = sqliteTable(
  "research_questions",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => researchRuns.requestId, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    status: text("status", { enum: ["pending", "covered", "partial", "uncovered"] })
      .notNull()
      .default("pending"),
    coverageNote: text("coverage_note"),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("research_questions_run_question_unique").on(table.requestId, table.questionId),
    index("research_questions_run_status_idx").on(table.requestId, table.status),
  ],
)

export const researchSources = sqliteTable(
  "research_sources",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => researchRuns.requestId, { onDelete: "cascade" }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    finalUrl: text("final_url"),
    title: text("title"),
    author: text("author"),
    publishedAt: text("published_at"),
    discoveredByQuery: text("discovered_by_query"),
    questionIdsJson: text("question_ids_json").notNull().default("[]"),
    status: text("status", {
      enum: ["discovered", "shortlisted", "reading", "read", "unusable"],
    }).notNull(),
    contentType: text("content_type"),
    contentHash: text("content_hash"),
    charCount: integer("char_count"),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    errorMessage: text("error_message"),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("research_sources_run_url_unique").on(table.requestId, table.canonicalUrl),
    index("research_sources_run_status_idx").on(table.requestId, table.status),
  ],
)

export const researchEvidence = sqliteTable(
  "research_evidence",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => researchRuns.requestId, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => researchSources.id, { onDelete: "cascade" }),
    researchQuestionId: text("research_question_id")
      .notNull()
      .references(() => researchQuestions.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: ["supports", "refutes", "qualifies"] }).notNull(),
    claim: text("claim").notNull(),
    excerpt: text("excerpt").notNull(),
    locator: text("locator"),
    createdAt,
  },
  (table) => [
    index("research_evidence_run_question_idx").on(table.requestId, table.researchQuestionId),
    index("research_evidence_source_idx").on(table.sourceId),
  ],
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

export const taskResourceBindings = sqliteTable(
  "task_resource_bindings",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => taskRuns.requestId, { onDelete: "cascade" }),
    resourceType: text("resource_type", {
      enum: ["attachment", "document", "project"],
    }).notNull(),
    resourceId: text("resource_id").notNull(),
    role: text("role", { enum: ["context", "output", "scope"] }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("task_resource_bindings_unique").on(
      table.taskId,
      table.runId,
      table.resourceType,
      table.resourceId,
      table.role,
    ),
    index("task_resource_bindings_task_created_idx").on(table.taskId, table.createdAt),
    index("task_resource_bindings_run_idx").on(table.runId),
  ],
)

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => taskRuns.requestId, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    relation: text("relation", { enum: ["created", "imported", "updated"] }).notNull(),
    status: text("status", { enum: ["active", "missing"] })
      .notNull()
      .default("active"),
    createdAt,
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("artifacts_run_document_relation_unique").on(table.runId, table.documentId, table.relation),
    index("artifacts_task_updated_idx").on(table.taskId, table.updatedAt),
    index("artifacts_document_idx").on(table.documentId),
  ],
)

export const workspaceOperations = sqliteTable(
  "workspace_operations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskSessions.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => taskRuns.requestId, { onDelete: "set null" }),
    operation: text("operation", {
      enum: ["create-document", "create-project", "move-documents", "inspect-project"],
    }).notNull(),
    status: text("status", { enum: ["applied", "conflict", "failed"] }).notNull(),
    parametersJson: text("parameters_json").notNull(),
    resultJson: text("result_json"),
    recoveryJson: text("recovery_json"),
    errorMessage: text("error_message"),
    createdAt,
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("workspace_operations_task_created_idx").on(table.taskId, table.createdAt),
    index("workspace_operations_run_idx").on(table.runId),
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

export const mcpServerConfigs = sqliteTable(
  "mcp_server_configs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    transport: text("transport", { enum: ["stdio", "streamable-http", "sse"] }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    trusted: integer("trusted", { mode: "boolean" }).notNull().default(false),
    command: text("command"),
    argsJson: text("args_json").notNull().default("[]"),
    url: text("url"),
    timeoutMs: integer("timeout_ms").notNull().default(20_000),
    envCiphertext: text("env_ciphertext"),
    headersCiphertext: text("headers_ciphertext"),
    disabledToolsJson: text("disabled_tools_json").notNull().default("[]"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "mcp_server_configs_transport_check",
      sql`${table.transport} IN ('stdio', 'streamable-http', 'sse')`,
    ),
    index("mcp_server_configs_enabled_idx").on(table.enabled),
    index("mcp_server_configs_name_idx").on(table.name),
  ],
)

export const userSkillConfigs = sqliteTable(
  "user_skill_configs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    fileCount: integer("file_count").notNull(),
    totalBytes: integer("total_bytes").notNull(),
    installedAt: integer("installed_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("user_skill_configs_name_unique").on(table.name),
    index("user_skill_configs_enabled_idx").on(table.enabled),
    index("user_skill_configs_name_idx").on(table.name),
  ],
)

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type ContentLibrary = typeof contentLibraries.$inferSelect
export type NewContentLibrary = typeof contentLibraries.$inferInsert
export type IndexedDocument = typeof documentIndex.$inferSelect
export type AgentSession = typeof agentSessions.$inferSelect
export type AgentEventRecord = typeof agentEvents.$inferSelect
export type PermissionDecision = typeof permissionDecisions.$inferSelect
export type TaskSession = typeof taskSessions.$inferSelect
export type TaskMessageRecord = typeof taskMessages.$inferSelect
export type TaskRun = typeof taskRuns.$inferSelect
export type TaskRunEventRecord = typeof taskRunEvents.$inferSelect
export type ResearchRunRecord = typeof researchRuns.$inferSelect
export type ResearchQuestionRecord = typeof researchQuestions.$inferSelect
export type ResearchSourceRecord = typeof researchSources.$inferSelect
export type ResearchEvidenceRecord = typeof researchEvidence.$inferSelect
export type AgentChangeProposal = typeof agentChangeProposals.$inferSelect
export type TaskResourceBindingRecord = typeof taskResourceBindings.$inferSelect
export type ArtifactRecord = typeof artifacts.$inferSelect
export type WorkspaceOperationRecord = typeof workspaceOperations.$inferSelect
export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect
export type NewAiProviderConfigRecord = typeof aiProviderConfigs.$inferInsert
export type McpServerConfigRecord = typeof mcpServerConfigs.$inferSelect
export type NewMcpServerConfigRecord = typeof mcpServerConfigs.$inferInsert
export type UserSkillConfigRecord = typeof userSkillConfigs.$inferSelect
export type NewUserSkillConfigRecord = typeof userSkillConfigs.$inferInsert
