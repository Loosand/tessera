/**
 * [INPUT]: 任务摘要、右键触发元素与任务打开/重命名/删除回调
 * [OUTPUT]: 对话上下文菜单与受控重命名对话框
 * [POS]: 任务列表和设计系统菜单/对话框之间的产品命令层
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSummary } from "@tessera/contracts"
import { BookOpen01Icon, Delete02Icon, Edit02Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@tessera/design-system/components/ui/context-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@tessera/design-system/components/ui/dialog"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { type FormEvent, type ReactElement, useState } from "react"

type TaskContextMenuProps = Readonly<{
  task: TaskSessionSummary
  trigger: ReactElement
  onDelete: (taskId: string) => Promise<boolean>
  onOpen: (task: TaskSessionSummary) => void
  onRename: (taskId: string, title: string) => Promise<boolean>
}>

export function TaskContextMenu({ task, trigger, onDelete, onOpen, onRename }: TaskContextMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [submitting, setSubmitting] = useState(false)

  const openRename = () => {
    setTitle(task.title)
    setRenameOpen(true)
  }

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle || submitting) return
    setSubmitting(true)
    const renamed = await onRename(task.id, nextTitle)
    setSubmitting(false)
    if (renamed) setRenameOpen(false)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={trigger} />
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpen(task)}>
            <Icon icon={BookOpen01Icon} size={15} />
            打开对话
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={openRename}>
            <Icon icon={Edit02Icon} size={15} />
            重命名…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onClick={() => void onDelete(task.id)}>
            <Icon icon={Delete02Icon} size={15} />
            删除对话…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogTitle>重命名对话</DialogTitle>
          <DialogDescription>名称会同步显示在最近任务和当前工作区中。</DialogDescription>
          <form className="mt-4" onSubmit={submitRename}>
            <Input
              autoFocus
              value={title}
              maxLength={120}
              aria-label="对话名称"
              className="focus-visible:border-input focus-visible:ring-0"
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <DialogClose render={<Button type="button" variant="outline" size="sm" />}>取消</DialogClose>
              <Button type="submit" size="sm" disabled={!title.trim() || submitting}>
                {submitting ? "保存中…" : "保存"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
