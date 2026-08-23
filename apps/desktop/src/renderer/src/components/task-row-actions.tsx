/**
 * [INPUT]: 任务置顶/归档状态与异步更新回调
 * [OUTPUT]: 位于任务菜单项右侧、支持加载态和键盘访问的置顶/归档/恢复按钮组
 * [POS]: 任务导航行与任务领域操作之间的紧凑行尾命令层
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSummary } from "@tessera/contracts"
import {
  Archive02Icon,
  ArchiveRestoreIcon,
  PinIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { cn } from "@tessera/design-system/lib/utils"
import { type MouseEvent, useState } from "react"

type TaskRowActionsProps = Readonly<{
  className?: string
  task: TaskSessionSummary
  onSetArchived: (taskId: string, archived: boolean) => Promise<boolean>
  onSetPinned: (taskId: string, pinned: boolean) => Promise<boolean>
}>

export function TaskRowActions({
  className,
  task,
  onSetArchived,
  onSetPinned,
}: TaskRowActionsProps) {
  const [pending, setPending] = useState<"archive" | "pin" | null>(null)
  const archived = task.archivedAt !== null
  const pinned = task.pinnedAt !== null

  const runAction = async (
    event: MouseEvent<HTMLButtonElement>,
    action: "archive" | "pin",
    run: () => Promise<boolean>,
  ) => {
    event.stopPropagation()
    if (pending) return
    setPending(action)
    try {
      await run()
    } finally {
      setPending(null)
    }
  }

  return (
    <span className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {!archived ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 rounded-md text-muted-foreground data-[active=true]:bg-foreground/8 data-[active=true]:text-foreground"
          aria-label={pinned ? `取消置顶“${task.title}”` : `置顶“${task.title}”`}
          title={pinned ? "取消置顶" : "置顶"}
          disabled={pending !== null}
          data-active={pinned || undefined}
          onClick={(event) => void runAction(event, "pin", () => onSetPinned(task.id, !pinned))}
        >
          {pending === "pin" ? (
            <span
              aria-hidden="true"
              className="size-3 animate-spin rounded-full border border-current/25 border-t-current motion-reduce:animate-none"
            />
          ) : (
            <Icon icon={PinIcon} size={13} />
          )}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-6 rounded-md text-muted-foreground"
        aria-label={archived ? `恢复“${task.title}”` : `归档“${task.title}”`}
        title={archived ? "移出归档" : "归档"}
        disabled={pending !== null}
        onClick={(event) =>
          void runAction(event, "archive", () => onSetArchived(task.id, !archived))
        }
      >
        {pending === "archive" ? (
          <span
            aria-hidden="true"
            className="size-3 animate-spin rounded-full border border-current/25 border-t-current motion-reduce:animate-none"
          />
        ) : (
          <Icon icon={archived ? ArchiveRestoreIcon : Archive02Icon} size={13} />
        )}
      </Button>
    </span>
  )
}
