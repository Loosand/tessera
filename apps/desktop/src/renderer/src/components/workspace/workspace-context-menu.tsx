/**
 * [INPUT]: 工作区摘要、右键触发元素与最近工作区操作
 * [OUTPUT]: 不触碰磁盘内容的工作区上下文菜单
 * [POS]: 最近工作区列表和设计系统 ContextMenu 之间的产品命令层
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceInfo } from "@tessera/contracts"
import {
  BookOpen01Icon,
  Copy01Icon,
  Delete02Icon,
  FolderOpenIcon,
} from "@tessera/design-system/components/icons"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@tessera/design-system/components/ui/context-menu"
import { Icon } from "@tessera/design-system/components/ui/icon"
import type { ReactElement } from "react"

type WorkspaceContextMenuProps = Readonly<{
  trigger: ReactElement
  workspace: WorkspaceInfo
  onCopyPath: (workspaceId: string) => void
  onOpen: (workspaceId: string) => void
  onRemove: (workspaceId: string) => void
  onReveal: (workspaceId: string) => void
}>

export function WorkspaceContextMenu({
  trigger,
  workspace,
  onCopyPath,
  onOpen,
  onRemove,
  onReveal,
}: WorkspaceContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={trigger} />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onOpen(workspace.id)}>
          <Icon icon={BookOpen01Icon} size={15} />
          打开工作区
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onReveal(workspace.id)}>
          <Icon icon={FolderOpenIcon} size={15} />在 Finder 中显示
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCopyPath(workspace.id)}>
          <Icon icon={Copy01Icon} size={15} />
          复制工作区路径
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onClick={() => onRemove(workspace.id)}>
          <Icon icon={Delete02Icon} size={15} />
          从最近列表移除…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
