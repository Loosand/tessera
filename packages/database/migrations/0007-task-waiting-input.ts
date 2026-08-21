/**
 * [INPUT]: 客户端交互工具需要在模型请求结束后持久化“等待用户回答”的任务状态
 * [OUTPUT]: 不破坏旧 status CHECK 的等待输入兼容标记
 * [POS]: 数据库从流式运行状态演进到可跨重启恢复人工输入断点的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskWaitingInputMigration = {
  id: "0007-task-waiting-input",
  statements: ["ALTER TABLE task_sessions ADD COLUMN waiting_for_input INTEGER NOT NULL DEFAULT 0"],
} as const satisfies DatabaseMigration
