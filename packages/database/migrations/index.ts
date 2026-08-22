/**
 * [INPUT]: 所有按版本排序的数据库迁移定义
 * [OUTPUT]: 只读迁移清单和幂等迁移执行函数
 * [POS]: 数据库启动时使用的前向迁移入口
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type BetterSqlite3 from "better-sqlite3"
import { foundationMigration } from "./0000-foundation"
import { aiProviderConfigsMigration } from "./0001-ai-provider-configs"
import { taskSessionsMigration } from "./0002-task-sessions"
import { workspaceRecentsMigration } from "./0003-workspace-recents"
import { agentRunsAndChangesMigration } from "./0004-agent-runs-and-changes"
import { aiProviderConnectionsMigration } from "./0005-ai-provider-connections"
import { taskSkillsMigration } from "./0006-task-skills"
import { taskWaitingInputMigration } from "./0007-task-waiting-input"
import { mcpServersMigration } from "./0008-mcp-servers"
import { taskRunPolicyMigration } from "./0009-task-run-policy"
import { taskRunContextMigration } from "./0010-task-run-context"
import { userSkillsMigration } from "./0011-user-skills"
import { taskRunObservabilityMigration } from "./0012-task-run-observability"
import { unifiedContentDomainMigration } from "./0013-unified-content-domain"
import { researchWorkflowMigration } from "./0014-research-workflow"
import { researchQuestionPositionMigration } from "./0015-research-question-position"
import type { DatabaseMigration } from "./types"

export type { DatabaseMigration } from "./types"

export const DATABASE_MIGRATIONS = [
  foundationMigration,
  aiProviderConfigsMigration,
  taskSessionsMigration,
  workspaceRecentsMigration,
  agentRunsAndChangesMigration,
  aiProviderConnectionsMigration,
  taskSkillsMigration,
  taskWaitingInputMigration,
  mcpServersMigration,
  taskRunPolicyMigration,
  taskRunContextMigration,
  userSkillsMigration,
  taskRunObservabilityMigration,
  unifiedContentDomainMigration,
  researchWorkflowMigration,
  researchQuestionPositionMigration,
] as const satisfies readonly DatabaseMigration[]

export type DatabaseMigrationId = (typeof DATABASE_MIGRATIONS)[number]["id"]

export function applyDatabaseMigrations(database: BetterSqlite3.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS __tessera_migrations (
    id TEXT PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`)

  const hasMigration = database.prepare("SELECT 1 FROM __tessera_migrations WHERE id = ?")
  const recordMigration = database.prepare("INSERT INTO __tessera_migrations (id) VALUES (?)")

  const applyPending = database.transaction(() => {
    for (const migration of DATABASE_MIGRATIONS) {
      if (hasMigration.get(migration.id)) continue
      for (const statement of migration.statements) database.exec(statement)
      recordMigration.run(migration.id)
    }
  })

  applyPending()
}
