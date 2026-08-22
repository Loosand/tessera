/**
 * [INPUT]: MCP 服务器配置、禁用工具清单和 safeStorage 加密凭据的持久化需求
 * [OUTPUT]: 可前向创建的 mcp_server_configs 表及查询索引
 * [POS]: 数据库从 AI 供应商配置演进到外部 MCP 服务器配置的迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/mcp.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const mcpServersMigration = {
  id: "0008-mcp-servers",
  statements: [
    `CREATE TABLE mcp_server_configs (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable-http', 'sse')),
      enabled INTEGER NOT NULL DEFAULT 0,
      trusted INTEGER NOT NULL DEFAULT 0,
      command TEXT,
      args_json TEXT NOT NULL DEFAULT '[]',
      url TEXT,
      timeout_ms INTEGER NOT NULL DEFAULT 20000,
      env_ciphertext TEXT,
      headers_ciphertext TEXT,
      disabled_tools_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    )`,
    "CREATE INDEX mcp_server_configs_enabled_idx ON mcp_server_configs (enabled)",
    "CREATE INDEX mcp_server_configs_name_idx ON mcp_server_configs (name)",
  ],
} as const satisfies DatabaseMigration
