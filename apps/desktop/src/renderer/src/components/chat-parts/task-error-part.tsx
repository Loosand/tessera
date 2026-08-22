/**
 * [INPUT]: AI SDK data-task-error Part 与所属消息的可选重新生成回调
 * [OUTPUT]: 对话消息内可恢复、可重试的运行失败状态
 * [POS]: Chat/Agent 消息 Part 呈现层中的整轮生成失败边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { InformationCircleIcon, Refresh01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"

type TaskErrorPartValue = Extract<UIMessage["parts"][number], { type: "data-task-error" }>

export function isTaskErrorPart(part: UIMessage["parts"][number]): part is TaskErrorPartValue {
  return part.type === "data-task-error"
}

export function TaskErrorPart({
  onRetry,
  part,
}: Readonly<{
  onRetry?: (() => void) | undefined
  part: TaskErrorPartValue
}>) {
  return (
    <div
      className="my-2 flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5"
      role="alert"
    >
      <Icon icon={InformationCircleIcon} size={15} className="mt-0.5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">这次生成未完成</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{part.data.message}</p>
      </div>
      {part.data.retryable && onRetry ? (
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <Icon icon={Refresh01Icon} size={12} />
          重试
        </Button>
      ) : null}
    </div>
  )
}
