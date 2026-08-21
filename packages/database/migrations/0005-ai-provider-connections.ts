/**
 * [INPUT]: 既有单例 AI 供应商配置与任务运行记录
 * [OUTPUT]: 支持同一兼容协议保存多条命名连接的配置表和运行连接标识
 * [POS]: 数据库从“供应商即配置”演进到“协议模板下有多个连接实例”的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const aiProviderConnectionsMigration: DatabaseMigration = {
  id: "0005-ai-provider-connections",
  statements: [
    `CREATE TABLE ai_provider_connections (
      config_id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      base_url TEXT NOT NULL,
      models_json TEXT NOT NULL DEFAULT '[]',
      api_key_ciphertext TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `INSERT INTO ai_provider_connections (
      config_id,
      provider_id,
      display_name,
      enabled,
      base_url,
      models_json,
      api_key_ciphertext,
      updated_at
    )
    SELECT
      provider_id,
      provider_id,
      CASE provider_id
        WHEN 'openai-compatible' THEN 'OpenAI 兼容'
        WHEN 'anthropic-compatible' THEN 'Anthropic 兼容'
        WHEN 'deepseek' THEN 'DeepSeek'
        WHEN 'grok' THEN 'Grok'
        WHEN 'openrouter' THEN 'OpenRouter'
        ELSE provider_id
      END,
      enabled,
      base_url,
      models_json,
      api_key_ciphertext,
      updated_at
    FROM ai_provider_configs`,
    "DROP TABLE ai_provider_configs",
    "ALTER TABLE ai_provider_connections RENAME TO ai_provider_configs",
    "CREATE INDEX ai_provider_configs_provider_idx ON ai_provider_configs (provider_id)",
    "ALTER TABLE task_runs ADD COLUMN config_id TEXT NOT NULL DEFAULT ''",
    "UPDATE task_runs SET config_id = provider_id WHERE config_id = ''",
  ],
}
