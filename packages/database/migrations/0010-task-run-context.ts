/**
 * [INPUT]: 已有逐轮策略列与统一 Agent 对完整 RunPolicy、资源可见范围的审计需求
 * [OUTPUT]: 不包含正文和绝对路径的策略 JSON、资源摘要 JSON 持久化字段
 * [POS]: 数据库从基础策略列演进到可恢复完整运行上下文摘要的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskRunContextMigration = {
  id: "0010-task-run-context",
  statements: [
    "ALTER TABLE task_runs ADD COLUMN policy_json TEXT",
    "ALTER TABLE task_runs ADD COLUMN resource_summary_json TEXT",
  ],
} as const satisfies DatabaseMigration
