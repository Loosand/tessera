/**
 * [INPUT]: 已有任务运行检查点与 AI SDK 原生生命周期完成事件中的结束原因、Token、缓存和性能指标
 * [OUTPUT]: 可在本地查询的 SDK call 关联、完成原因、用量、步骤/工具计数与耗时字段
 * [POS]: 数据库从可恢复运行事件演进到产品级运行汇总可观测性的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskRunObservabilityMigration = {
  id: "0012-task-run-observability",
  statements: [
    "ALTER TABLE task_runs ADD COLUMN sdk_call_id TEXT",
    "ALTER TABLE task_runs ADD COLUMN finish_reason TEXT",
    "ALTER TABLE task_runs ADD COLUMN raw_finish_reason TEXT",
    "ALTER TABLE task_runs ADD COLUMN input_tokens INTEGER",
    "ALTER TABLE task_runs ADD COLUMN cache_read_tokens INTEGER",
    "ALTER TABLE task_runs ADD COLUMN cache_write_tokens INTEGER",
    "ALTER TABLE task_runs ADD COLUMN output_tokens INTEGER",
    "ALTER TABLE task_runs ADD COLUMN reasoning_tokens INTEGER",
    "ALTER TABLE task_runs ADD COLUMN total_tokens INTEGER",
    "ALTER TABLE task_runs ADD COLUMN step_count INTEGER",
    "ALTER TABLE task_runs ADD COLUMN tool_call_count INTEGER",
    "ALTER TABLE task_runs ADD COLUMN time_to_first_output_ms INTEGER",
    "ALTER TABLE task_runs ADD COLUMN model_duration_ms INTEGER",
    "ALTER TABLE task_runs ADD COLUMN tool_duration_ms INTEGER",
    "ALTER TABLE task_runs ADD COLUMN duration_ms INTEGER",
  ],
} as const satisfies DatabaseMigration
