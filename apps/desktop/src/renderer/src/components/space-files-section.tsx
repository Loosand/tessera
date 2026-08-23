/**
 * [INPUT]: 当前文件 Space 的目录/Markdown 文档索引、活动文档路径与受限文件操作
 * [OUTPUT]: 一级 Space 侧栏内带叶节点自然缩进与右侧安全区的可折叠文件树，以及新增、刷新、重命名、定位和废纸篓入口
 * [POS]: Space 主侧栏中的文件浏览区块，不创建独立工作区导航层
 * [DOC]: design.md、docs/architecture/editor.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceDirectoryEntry, WorkspaceDocumentEntry, WorkspaceEntryKind } from "@tessera/contracts"
import {
  File02Icon,
  FileAddIcon,
  Folder01Icon,
  FolderAddIcon,
  FolderOpenIcon,
  Refresh01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { useEffect, useMemo, useState } from "react"
import {
  type DocumentTreeNode,
  buildDocumentTree,
  collectFolderPaths,
  fileTreeNodeInset,
} from "./space-files-model"
import { WorkspaceEntryContextMenu } from "./workspace-entry-context-menu"

type SpaceFilesSectionProps = Readonly<{
  activePath: string | undefined
  directories: readonly WorkspaceDirectoryEntry[]
  documents: readonly WorkspaceDocumentEntry[]
  onCopyPath: (relativePath: string) => void
  onCreateDirectory: (parentRelativePath?: string) => void
  onCreateDocument: (parentRelativePath?: string) => void
  onDeleteEntry: (relativePath: string, kind: WorkspaceEntryKind) => void
  onOpenDocument: (relativePath: string) => void
  onRefresh: () => void
  onRenameDirectory: (relativePath: string) => void
  onRenameDocument: (relativePath: string) => void
  onReveal: (relativePath: string) => void
}>

function documentLabel(name: string) {
  return name.replace(/\.(?:md|markdown)$/i, "")
}

export function SpaceFilesSection({
  activePath,
  directories,
  documents,
  onCopyPath,
  onCreateDirectory,
  onCreateDocument,
  onDeleteEntry,
  onOpenDocument,
  onRefresh,
  onRenameDirectory,
  onRenameDocument,
  onReveal,
}: SpaceFilesSectionProps) {
  const tree = useMemo(() => buildDocumentTree(documents, directories), [directories, documents])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpandedFolders((current) => {
      const availableFolders = collectFolderPaths(tree)
      const next = new Set([...current].filter((path) => availableFolders.has(path)))
      const activeSegments = activePath?.split("/").slice(0, -1) ?? []
      activeSegments.forEach((_, index) => next.add(activeSegments.slice(0, index + 1).join("/")))
      return next
    })
  }, [activePath, tree])

  const revealCreationParent = (path: string) => {
    if (!path) return
    setExpandedFolders((current) => new Set(current).add(path))
  }

  const createDocumentAt = (parentRelativePath: string) => {
    revealCreationParent(parentRelativePath)
    onCreateDocument(parentRelativePath)
  }

  const createDirectoryAt = (parentRelativePath: string) => {
    revealCreationParent(parentRelativePath)
    onCreateDirectory(parentRelativePath)
  }

  const renderTreeNode = (node: DocumentTreeNode, depth: number) => {
    if (node.document) {
      return (
        <WorkspaceEntryContextMenu
          key={node.path}
          kind="document"
          relativePath={node.path}
          trigger={
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1.5 rounded-xl pr-4 text-left text-[12px] transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
              style={{ paddingLeft: fileTreeNodeInset(depth) }}
              data-active={node.path === activePath || undefined}
              aria-current={node.path === activePath ? "page" : undefined}
              title={node.path}
              onClick={() => onOpenDocument(node.path)}
            >
              <Icon icon={File02Icon} size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{documentLabel(node.name)}</span>
            </button>
          }
          onOpen={() => onOpenDocument(node.path)}
          onCreateDocument={createDocumentAt}
          onCreateDirectory={createDirectoryAt}
          onRename={() => onRenameDocument(node.path)}
          onDelete={() => onDeleteEntry(node.path, "document")}
          onReveal={() => onReveal(node.path)}
          onCopyPath={() => onCopyPath(node.path)}
        />
      )
    }

    const expanded = expandedFolders.has(node.path)
    return (
      <div key={node.path}>
        <WorkspaceEntryContextMenu
          kind="directory"
          relativePath={node.path}
          trigger={
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1.5 rounded-xl pr-4 text-left text-[12px] transition-colors hover:bg-sidebar-accent"
              style={{ paddingLeft: fileTreeNodeInset(depth) }}
              aria-expanded={expanded}
              title={node.path}
              onClick={() => {
                setExpandedFolders((current) => {
                  const next = new Set(current)
                  if (next.has(node.path)) next.delete(node.path)
                  else next.add(node.path)
                  return next
                })
              }}
            >
              <span
                className={`flex size-3 shrink-0 items-center justify-center text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                aria-hidden="true"
              >
                <span className="block size-0 border-y-[3px] border-y-transparent border-l-[4px] border-l-current" />
              </span>
              <Icon
                icon={expanded ? FolderOpenIcon : Folder01Icon}
                size={14}
                className="shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
          }
          onCreateDocument={createDocumentAt}
          onCreateDirectory={createDirectoryAt}
          onRename={() => onRenameDirectory(node.path)}
          onDelete={() => onDeleteEntry(node.path, "directory")}
          onReveal={() => onReveal(node.path)}
          onCopyPath={() => onCopyPath(node.path)}
        />
        {expanded ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    )
  }

  return (
    <section className="mt-5">
      <header className="group/files flex h-7 items-center px-2">
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-muted-foreground">文件</span>
        <span className="mr-1 text-[10px] tabular-nums text-muted-foreground">{documents.length}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 text-muted-foreground"
          aria-label="新建文档"
          title="新建文档"
          onClick={() => onCreateDocument()}
        >
          <Icon icon={FileAddIcon} size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 text-muted-foreground"
          aria-label="新建文件夹"
          title="新建文件夹"
          onClick={() => onCreateDirectory()}
        >
          <Icon icon={FolderAddIcon} size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 text-muted-foreground"
          aria-label="刷新文件"
          title="刷新文件"
          onClick={onRefresh}
        >
          <Icon icon={Refresh01Icon} size={13} />
        </Button>
      </header>

      <div className="grid gap-0.5 pr-1">
        {tree.length > 0 ? (
          tree.map((node) => renderTreeNode(node, 0))
        ) : (
          <p className="px-2 py-2 text-[11px] leading-5 text-muted-foreground">
            这个 Space 还没有 Markdown 文档。
          </p>
        )}
      </div>
    </section>
  )
}
