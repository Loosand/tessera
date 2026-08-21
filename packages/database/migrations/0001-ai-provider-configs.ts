/**
 * [INPUT]: AI 供应商普通配置与 Electron safeStorage 密文的持久化需求
 * [OUTPUT]: 可在单个事务中执行的 0001-ai-provider-configs 迁移
 * [POS]: Tessera 本地数据库的 AI 供应商配置前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const aiProviderConfigsMigration = {
  id: "0001-ai-provider-configs",
  statements: [
    `CREATE TABLE ai_provider_configs (
      provider_id TEXT PRIMARY KEY NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      base_url TEXT NOT NULL,
      models_json TEXT NOT NULL DEFAULT '[]',
      api_key_ciphertext TEXT,
      updated_at INTEGER NOT NULL
    )`,
  ],
} as const satisfies DatabaseMigration
