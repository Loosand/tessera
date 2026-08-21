/**
 * [INPUT]: 工作区文件/文件夹身份、右键触发元素与受限条目操作
 * [OUTPUT]: Notion 密度的文件系统上下文菜单
 * [POS]: 工作区侧栏与设计系统 ContextMenu 之间的产品命令层
 * [DOC]: design.md、docs/architecture.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceEntryKind } from "@tessera/contracts"
import {
  BookOpen01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  FileAddIcon,
  FolderAddIcon,
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

interface WorkspaceEntryContextMenuProps {
  kind: WorkspaceEntryKind
  relativePath: string
  trigger: ReactElement
  onCopyPath: () => void
  onCreateDirectory: (parentRelativePath: string) => void
  onCreateDocument: (parentRelativePath: string) => void
  onDelete: () => void
  onOpen?: () => void
  onRename: () => void
  onReveal: () => void
}

function parentPath(relativePath: string) {
  const separator = relativePath.lastIndexOf("/")
  return separator < 0 ? "" : relativePath.slice(0, separator)
}

export function WorkspaceEntryContextMenu({
  kind,
  relativePath,
  trigger,
  onCopyPath,
  onCreateDirectory,
  onCreateDocument,
  onDelete,
  onOpen,
  onRename,
  onReveal,
}: WorkspaceEntryContextMenuProps) {
  const creationParent = kind === "directory" ? relativePath : parentPath(relativePath)

  return (
    <ContextMenu>
      <ContextMenuTrigger render={trigger} />
      <ContextMenuContent>
        {kind === "document" && onOpen ? (
          <>
            <ContextMenuItem onClick={onOpen}>
              <Icon icon={BookOpen01Icon} size={15} />
              打开
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}

        <ContextMenuItem onClick={() => onCreateDocument(creationParent)}>
          <Icon icon={FileAddIcon} size={15} />
          新建文档
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCreateDirectory(creationParent)}>
          <Icon icon={FolderAddIcon} size={15} />
          新建文件夹
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename}>
          <Icon icon={Edit02Icon} size={15} />
          重命名…
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyPath}>
          <Icon icon={Copy01Icon} size={15} />
          复制{kind === "directory" ? "文件夹" : "文件"}路径
        </ContextMenuItem>
        <ContextMenuItem onClick={onReveal}>
          <Icon icon={FolderOpenIcon} size={15} />在 Finder 中显示
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem destructive onClick={onDelete}>
          <Icon icon={Delete02Icon} size={15} />
          移到废纸篓…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
