/**
 * [INPUT]: SQLite 中启动后仍为 running 的 task_run / task_session 与任务状态更新回调
 * [OUTPUT]: 追加类型化中断事件、结束僵尸运行、校正会话状态，并识别尚未写入 task_messages 的最新运行事件
 * [POS]: Electron 启动流程与可测试持久化恢复协议之间的边界
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamEvent, TaskRunErrorDataV1, TaskSessionSnapshot } from "@tessera/contracts"
import {
  type DatabaseClient,
  appendTaskRunEvent,
  findLatestTaskRun,
  findLatestTaskRunStatus,
  finishTaskRun,
  listRunningTaskRuns,
  listTaskSessionRunStates,
} from "@tessera/database"

export function findUnpersistedLatestTaskRun(
  client: DatabaseClient,
  task: Pick<TaskSessionSnapshot, "id" | "messages">,
) {
  const run = findLatestTaskRun(client, task.id)
  if (!run) return null
  const alreadyPersisted = task.messages.some(
    (message) => message.role === "assistant" && message.metadata?.requestId === run.requestId,
  )
  return alreadyPersisted ? null : run
}

export function interruptedTaskRunFailure(): TaskRunErrorDataV1 {
  return {
    code: "stream-interrupted",
    phase: "stream",
    message: "应用上次运行时意外中断，已恢复中断前的可见进度；磁盘写入不会自动重放，请继续或重试。",
    retryable: true,
    version: 1,
  }
}

export function recoverInterruptedTaskRuns(
  client: DatabaseClient,
  setTaskStatus: (taskId: string, status: "cancelled" | "completed" | "failed") => void,
  now = Date.now(),
) {
  const recoveredRequestIds: string[] = []
  for (const run of listRunningTaskRuns(client)) {
    const sequence = run.lastSequence + 1
    const failure = interruptedTaskRunFailure()
    const event: AiChatStreamEvent = {
      requestId: run.requestId,
      taskId: run.taskId,
      sequence,
      chunk: { type: "error", errorText: failure.message, failure },
    }
    appendTaskRunEvent(client, {
      requestId: run.requestId,
      sequence,
      payloadJson: JSON.stringify(event),
    })
    finishTaskRun(client, run.requestId, "interrupted", {
      finishReason: "interrupted",
      durationMs: Math.max(0, now - run.startedAt.getTime()),
    })
    recoveredRequestIds.push(run.requestId)
  }

  for (const task of listTaskSessionRunStates(client)) {
    const latestStatus = findLatestTaskRunStatus(client, task.id)
    const status =
      latestStatus === "completed"
        ? "completed"
        : latestStatus === "cancelled"
          ? "cancelled"
          : latestStatus === "failed" || latestStatus === "interrupted"
            ? "failed"
            : null
    if (status && task.status !== status) setTaskStatus(task.id, status)
  }
  return recoveredRequestIds
}
