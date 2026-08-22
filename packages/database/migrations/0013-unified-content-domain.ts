/**
 * [INPUT]: 统一创作 Agent 对内容库、托管工作区、动态资源、Artifact 与项目操作审计的持久化需求
 * [OUTPUT]: 不保存 Markdown 正文的内容控制层表，以及现有工作区的存储来源元数据
 * [POS]: 数据库从单工作区会话演进到后端无关内容对象与混合内容库实验的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const unifiedContentDomainMigration = {
  id: "0013-unified-content-domain",
  statements: [
    `CREATE TABLE content_libraries (
      id TEXT PRIMARY KEY NOT NULL,
      root_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`,
    "CREATE UNIQUE INDEX content_libraries_root_path_unique ON content_libraries (root_path)",
    "CREATE INDEX content_libraries_updated_idx ON content_libraries (updated_at)",
    "ALTER TABLE workspaces ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'external'",
    "ALTER TABLE workspaces ADD COLUMN content_library_id TEXT REFERENCES content_libraries(id) ON DELETE SET NULL",
    "CREATE INDEX workspaces_content_library_idx ON workspaces (content_library_id, storage_kind)",
    `CREATE TABLE task_resource_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES task_runs(request_id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL CHECK (resource_type IN ('attachment', 'document', 'project')),
      resource_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('context', 'output', 'scope')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    "CREATE UNIQUE INDEX task_resource_bindings_unique ON task_resource_bindings (task_id, run_id, resource_type, resource_id, role)",
    "CREATE INDEX task_resource_bindings_task_created_idx ON task_resource_bindings (task_id, created_at)",
    "CREATE INDEX task_resource_bindings_run_idx ON task_resource_bindings (run_id)",
    `CREATE TABLE artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES task_runs(request_id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      relation TEXT NOT NULL CHECK (relation IN ('created', 'imported', 'updated')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL
    )`,
    "CREATE UNIQUE INDEX artifacts_run_document_relation_unique ON artifacts (run_id, document_id, relation)",
    "CREATE INDEX artifacts_task_updated_idx ON artifacts (task_id, updated_at)",
    "CREATE INDEX artifacts_document_idx ON artifacts (document_id)",
    `CREATE TABLE workspace_operations (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES task_runs(request_id) ON DELETE SET NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create-document', 'create-project', 'move-documents', 'inspect-project')),
      status TEXT NOT NULL CHECK (status IN ('applied', 'conflict', 'failed')),
      parameters_json TEXT NOT NULL,
      result_json TEXT,
      recovery_json TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      completed_at INTEGER NOT NULL
    )`,
    "CREATE INDEX workspace_operations_task_created_idx ON workspace_operations (task_id, created_at)",
    "CREATE INDEX workspace_operations_run_idx ON workspace_operations (run_id)",
  ],
} as const satisfies DatabaseMigration
