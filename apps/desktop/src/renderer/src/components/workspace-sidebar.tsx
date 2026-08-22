/**
 * [INPUT]: 当前工作区、任务/文件分区、会话列表、文档草稿与工作区操作
 * [OUTPUT]: 可切换工作区的二级侧栏、带选中/运行状态的任务列表、文件树/列表和大纲
 * [POS]: Tessera 两级导航中的工作区侧栏
 * [DOC]: design.md、docs/architecture.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  TaskSessionSummary,
  WorkspaceDirectoryEntry,
  WorkspaceDocumentEntry,
  WorkspaceEntryKind,
  WorkspaceInfo,
} from "@tessera/contracts"
import {
  Add01Icon,
  ArrowLeft01Icon,
  BookOpen01Icon,
  CancelCircleIcon,
  Clock01Icon,
  File02Icon,
  Folder01Icon,
  FolderOpenIcon,
  FolderTreeIcon,
  Link01Icon,
  ListViewIcon,
  Menu01Icon,
  PanelLeftCloseIcon,
  PinIcon,
  SortingAZ01Icon,
  StarIcon,
  TaskAdd01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@tessera/design-system/components/ui/popover"
import { useEffect, useMemo, useState } from "react"
import { TaskContextMenu } from "./task-context-menu"
import { TaskNavigationRow } from "./task-navigation-row"
import { WorkspaceContextMenu } from "./workspace-context-menu"
import { WorkspaceEntryContextMenu } from "./workspace-entry-context-menu"
import {
  type DocumentTreeNode,
  type SidebarSort,
  buildDocumentTree,
  collectFolderPaths,
  extractDocumentOutline,
  sortDocuments,
} from "./workspace-sidebar-model"

type SidebarPane = "files" | "outline"
type FileLayout = "tree" | "list"
const MODIFIED_AT_FORMATTER = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" })

type WorkspaceSidebarProps = Readonly<{
  activeSection: "tasks" | "files"
  activeTaskId: string | undefined
  workspace: WorkspaceInfo | null
  tasks: readonly TaskSessionSummary[]
  recentWorkspaces: readonly WorkspaceInfo[]
  documents: readonly WorkspaceDocumentEntry[]
  directories: readonly WorkspaceDirectoryEntry[]
  activePath: string | undefined
  activeContent: string
  onCollapse: () => void
  onGoHome: () => void
  onNewTask: () => void
  onOpenTask: (taskId: string) => void
  onRenameTask: (taskId: string, title: string) => Promise<boolean>
  onDeleteTask: (taskId: string) => Promise<boolean>
  onSectionChange: (section: "tasks" | "files") => void
  onSelectWorkspace: () => void
  onOpenRecentWorkspace: (workspaceId: string) => void
  onRevealRecentWorkspace: (workspaceId: string) => void
  onCopyWorkspacePath: (workspaceId: string) => void
  onRemoveRecentWorkspace: (workspaceId: string) => void
  onRevealWorkspace: () => void
  onRefreshDocuments: () => void
  onCreateDocument: (parentRelativePath?: string) => void
  onCreateDirectory: (parentRelativePath?: string) => void
  onOpenDocument: (relativePath: string) => void
  onRenameDocument: (relativePath: string) => void
  onRenameDirectory: (relativePath: string) => void
  onDeleteWorkspaceEntry: (relativePath: string, kind: WorkspaceEntryKind) => void
  onRevealWorkspaceEntry: (relativePath: string) => void
  onCopyWorkspaceEntryPath: (relativePath: string) => void
  onSelectOutline: (index: number, line: number) => void
}>

function NavigationRow({
  icon,
  label,
  count,
  active = false,
  disabled = false,
}: {
  icon: Parameters<typeof Icon>[0]["icon"]
  label: string
  count?: number
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-2 rounded-md pr-3 pl-2 text-left text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-default disabled:opacity-45"
      data-active={active || undefined}
      disabled={disabled}
    >
      <Icon icon={icon} size={15} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="min-w-6 shrink-0 pr-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  )
}

function documentLabel(name: string) {
  return name.replace(/\.(?:md|markdown)$/i, "")
}

function documentLocation(relativePath: string) {
  const separator = relativePath.lastIndexOf("/")
  return separator > 0 ? relativePath.slice(0, separator) : "工作区根目录"
}

function formatModifiedAt(modifiedAt: number) {
  return MODIFIED_AT_FORMATTER.format(modifiedAt)
}

export function WorkspaceSidebar({
  activeSection,
  activeTaskId,
  workspace,
  tasks,
  recentWorkspaces,
  documents,
  directories,
  activePath,
  activeContent,
  onCollapse,
  onGoHome,
  onNewTask,
  onOpenTask,
  onRenameTask,
  onDeleteTask,
  onSectionChange,
  onSelectWorkspace,
  onOpenRecentWorkspace,
  onRevealRecentWorkspace,
  onCopyWorkspacePath,
  onRemoveRecentWorkspace,
  onRevealWorkspace,
  onRefreshDocuments,
  onCreateDocument,
  onCreateDirectory,
  onOpenDocument,
  onRenameDocument,
  onRenameDirectory,
  onDeleteWorkspaceEntry,
  onRevealWorkspaceEntry,
  onCopyWorkspaceEntryPath,
  onSelectOutline,
}: WorkspaceSidebarProps) {
  const [pane, setPane] = useState<SidebarPane>("files")
  const [layout, setLayout] = useState<FileLayout>("tree")
  const [sort, setSort] = useState<SidebarSort>("name-asc")
  const tree = useMemo(() => buildDocumentTree(documents, sort, directories), [directories, documents, sort])
  const list = useMemo(() => sortDocuments(documents, sort), [documents, sort])
  const outline = useMemo(() => extractDocumentOutline(activeContent), [activeContent])
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

  const toggleFolder = (path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

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
      const active = node.path === activePath
      return (
        <WorkspaceEntryContextMenu
          key={node.path}
          kind="document"
          relativePath={node.path}
          trigger={
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1.5 rounded-md pr-3 text-left text-[13px] transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
              style={{ paddingLeft: 6 + depth * 16 }}
              data-active={active || undefined}
              onClick={() => onOpenDocument(node.path)}
            >
              <span className="size-3 shrink-0" aria-hidden="true" />
              <Icon icon={File02Icon} size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{documentLabel(node.name)}</span>
            </button>
          }
          onOpen={() => onOpenDocument(node.path)}
          onCreateDocument={createDocumentAt}
          onCreateDirectory={createDirectoryAt}
          onRename={() => onRenameDocument(node.path)}
          onDelete={() => onDeleteWorkspaceEntry(node.path, "document")}
          onReveal={() => onRevealWorkspaceEntry(node.path)}
          onCopyPath={() => onCopyWorkspaceEntryPath(node.path)}
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
              className="flex h-7 w-full items-center gap-1.5 rounded-md pr-3 text-left text-[13px] transition-colors hover:bg-sidebar-accent"
              style={{ paddingLeft: 6 + depth * 16 }}
              aria-expanded={expanded}
              onClick={() => toggleFolder(node.path)}
            >
              <span
                className={`flex size-3 shrink-0 items-center justify-center text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                aria-hidden="true"
              >
                <span className="block size-0 border-y-[3.5px] border-y-transparent border-l-[5px] border-l-current" />
              </span>
              <Icon
                icon={expanded ? FolderOpenIcon : Folder01Icon}
                size={15}
                className="shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 truncate">{node.name}</span>
            </button>
          }
          onCreateDocument={createDocumentAt}
          onCreateDirectory={createDirectoryAt}
          onRename={() => onRenameDirectory(node.path)}
          onDelete={() => onDeleteWorkspaceEntry(node.path, "directory")}
          onReveal={() => onRevealWorkspaceEntry(node.path)}
          onCopyPath={() => onCopyWorkspaceEntryPath(node.path)}
        />
        {expanded ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    )
  }

  const workspaceMenu = workspace ? (
    <PopoverContent
      side="bottom"
      align="start"
      sideOffset={6}
      className="w-[250px] overflow-hidden p-0 max-[760px]:w-[240px]"
    >
      <div className="flex h-8 items-center justify-between px-2.5">
        <p className="text-[13px] font-medium">操作</p>
        <PopoverClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="关闭工作区菜单"
              title="关闭"
            />
          }
        >
          <Icon icon={CancelCircleIcon} size={14} />
        </PopoverClose>
      </div>

      <div className="grid px-1 pb-1">
        <PopoverClose
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start px-2 text-xs font-normal"
              onClick={() => onCreateDocument()}
            />
          }
        >
          新建文档
        </PopoverClose>
        <PopoverClose
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start px-2 text-xs font-normal"
              onClick={onRevealWorkspace}
            />
          }
        >
          在 Finder 中显示
        </PopoverClose>
        <PopoverClose
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start px-2 text-xs font-normal"
              onClick={onSelectWorkspace}
            />
          }
        >
          打开其他工作区…
        </PopoverClose>
        <PopoverClose
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start px-2 text-xs font-normal"
              onClick={onRefreshDocuments}
            />
          }
        >
          刷新文件
        </PopoverClose>
      </div>

      <div className="flex h-8 items-center gap-2 border-y border-border px-2.5">
        <p className="min-w-0 flex-1 text-xs font-medium">排序</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
            data-active={sort === "name-asc" || undefined}
            aria-pressed={sort === "name-asc"}
            aria-label="按名称排序"
            title="按名称排序"
            onClick={() => setSort("name-asc")}
          >
            <Icon icon={SortingAZ01Icon} size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
            data-active={sort === "modified-desc" || undefined}
            aria-pressed={sort === "modified-desc"}
            aria-label="按最近修改排序"
            title="按最近修改排序"
            onClick={() => setSort("modified-desc")}
          >
            <Icon icon={Clock01Icon} size={15} />
          </Button>
        </div>
      </div>

      {recentWorkspaces.some((recent) => recent.id !== workspace.id) ? (
        <div className="py-1">
          <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">最近使用的目录</p>
          <div className="grid px-1">
            {recentWorkspaces
              .filter((recent) => recent.id !== workspace.id)
              .slice(0, 6)
              .map((recent) => (
                <PopoverClose
                  key={recent.id}
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 min-w-0 justify-start gap-1.5 px-2 text-xs font-normal"
                      title={recent.rootPath}
                      onClick={() => onOpenRecentWorkspace(recent.id)}
                    />
                  }
                >
                  <Icon icon={Folder01Icon} size={13} className="shrink-0" />
                  <span className="truncate">{recent.name}</span>
                </PopoverClose>
              ))}
          </div>
        </div>
      ) : null}
    </PopoverContent>
  ) : null

  return (
    <aside className="group/sidebar flex h-full min-h-0 w-62.5 shrink-0 flex-col bg-sidebar text-sidebar-foreground max-[760px]:w-[240px] max-[760px]:shadow-xl">
      <div className="app-drag-region relative h-12 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="app-no-drag absolute top-3 right-2"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          onClick={onCollapse}
        >
          <Icon icon={PanelLeftCloseIcon} size={14} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2">
        {workspace ? (
          <>
            <div className="flex h-9 shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="返回工作区主页"
                title="返回工作区主页"
                onClick={onGoHome}
              >
                <Icon icon={ArrowLeft01Icon} size={14} />
              </Button>
              <WorkspaceContextMenu
                workspace={workspace}
                trigger={
                  <div className="min-w-0 flex-1">
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-full min-w-0 justify-start px-2 text-[13px] font-medium data-[popup-open]:bg-sidebar-accent"
                            title={workspace.rootPath}
                          />
                        }
                      >
                        <span className="truncate">{workspace.name}</span>
                      </PopoverTrigger>
                      {workspaceMenu}
                    </Popover>
                  </div>
                }
                onOpen={onOpenRecentWorkspace}
                onReveal={onRevealRecentWorkspace}
                onCopyPath={onCopyWorkspacePath}
                onRemove={onRemoveRecentWorkspace}
              />
            </div>

            <div className="mt-2 mb-3 grid h-8 shrink-0 grid-cols-2 rounded-md bg-sidebar-accent/55 p-0.5">
              <button
                type="button"
                className="rounded-[5px] text-xs transition-colors data-[active=true]:bg-background data-[active=true]:font-medium data-[active=true]:shadow-xs"
                data-active={activeSection === "tasks" || undefined}
                onClick={() => onSectionChange("tasks")}
              >
                任务
              </button>
              <button
                type="button"
                className="rounded-[5px] text-xs transition-colors data-[active=true]:bg-background data-[active=true]:font-medium data-[active=true]:shadow-xs"
                data-active={activeSection === "files" || undefined}
                onClick={() => onSectionChange("files")}
              >
                文件
              </button>
            </div>

            {activeSection === "tasks" ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 justify-start gap-2 px-2 text-[13px]"
                  onClick={onNewTask}
                >
                  <Icon icon={TaskAdd01Icon} size={15} />
                  <span>新任务</span>
                </Button>
                <header className="mt-3 flex h-7 shrink-0 items-center px-2 text-[11px] font-medium text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">你的任务</span>
                  <span className="tabular-nums">{tasks.length}</span>
                </header>
                <section className="min-h-0 flex-1 overflow-y-auto pb-2">
                  <div className="grid gap-0.5">
                    {tasks.map((task) => (
                      <TaskContextMenu
                        key={task.id}
                        task={task}
                        trigger={
                          <TaskNavigationRow
                            active={task.id === activeTaskId}
                            status={task.status}
                            taskTitle={task.title}
                            onClick={() => onOpenTask(task.id)}
                          />
                        }
                        onOpen={(selectedTask) => onOpenTask(selectedTask.id)}
                        onRename={onRenameTask}
                        onDelete={onDeleteTask}
                      />
                    ))}
                    {tasks.length === 0 ? (
                      <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
                        还没有历史任务。发送第一条消息后会自动保存。
                      </p>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <>
                <header className="group/view flex h-7 shrink-0 items-center px-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
                    {pane === "outline" ? "大纲" : "文件"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 transition-opacity group-hover/view:opacity-100 focus-visible:opacity-100"
                    aria-label={pane === "files" ? "切换到文档大纲" : "切换到文件视图"}
                    title={pane === "files" ? "切换到文档大纲" : "切换到文件视图"}
                    onClick={() => setPane((current) => (current === "files" ? "outline" : "files"))}
                  >
                    <Icon icon={pane === "files" ? Menu01Icon : FolderTreeIcon} size={15} />
                  </Button>
                </header>
                {pane === "files" ? (
                  <>
                    <div className="space-y-0.5 pb-3">
                      <NavigationRow icon={PinIcon} label="已固定" count={0} disabled />
                      <NavigationRow icon={BookOpen01Icon} label="全部文档" count={documents.length} active />
                      <NavigationRow icon={StarIcon} label="收藏夹" disabled />
                      <NavigationRow icon={Link01Icon} label="关联" disabled />
                    </div>
                    <section className="min-h-0 flex-1 overflow-y-auto pt-1 pb-2">
                      {(layout === "tree" ? tree.length > 0 : documents.length > 0) ? (
                        layout === "tree" ? (
                          tree.map((node) => renderTreeNode(node, 0))
                        ) : (
                          <div className="grid gap-0.5">
                            {list.map((document) => (
                              <WorkspaceEntryContextMenu
                                key={document.relativePath}
                                kind="document"
                                relativePath={document.relativePath}
                                trigger={
                                  <button
                                    type="button"
                                    className="rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent"
                                    data-active={document.relativePath === activePath || undefined}
                                    onClick={() => onOpenDocument(document.relativePath)}
                                  >
                                    <div className="flex items-center gap-2 text-xs font-medium">
                                      <span className="min-w-0 flex-1 truncate">
                                        {documentLabel(document.name)}
                                      </span>
                                      <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                                        {formatModifiedAt(document.modifiedAt)}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                      {documentLocation(document.relativePath)}
                                    </p>
                                  </button>
                                }
                                onOpen={() => onOpenDocument(document.relativePath)}
                                onCreateDocument={createDocumentAt}
                                onCreateDirectory={createDirectoryAt}
                                onRename={() => onRenameDocument(document.relativePath)}
                                onDelete={() => onDeleteWorkspaceEntry(document.relativePath, "document")}
                                onReveal={() => onRevealWorkspaceEntry(document.relativePath)}
                                onCopyPath={() => onCopyWorkspaceEntryPath(document.relativePath)}
                              />
                            ))}
                          </div>
                        )
                      ) : (
                        <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
                          这个工作区还没有 Markdown 文档。
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  <section className="min-h-0 flex-1 overflow-y-auto pt-1 pb-2">
                    {outline.length > 0 ? (
                      <div className="grid gap-0.5">
                        {outline.map((heading, index) => (
                          <button
                            key={`${heading.line}-${heading.text}`}
                            type="button"
                            className="min-h-7 w-full truncate rounded-md pr-2 text-left text-xs transition-colors hover:bg-sidebar-accent"
                            style={{ paddingLeft: 8 + (heading.depth - 1) * 12 }}
                            title={`${heading.text} · 第 ${heading.line} 行`}
                            onClick={() => onSelectOutline(index, heading.line)}
                          >
                            {heading.text}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
                        当前文档还没有 Markdown 标题。
                      </p>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-start justify-center px-3 pb-12">
            <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-sidebar-accent">
              <Icon icon={FolderOpenIcon} size={16} />
            </div>
            <p className="font-medium">打开一个工作区</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              选择本地文件夹后，文档仍保留在原来的位置。
            </p>
            <Button size="sm" className="mt-4" onClick={onSelectWorkspace}>
              选择文件夹
            </Button>
          </div>
        )}

        <footer className="-mx-2 mt-auto flex h-11 shrink-0 items-center gap-1 border-t border-sidebar-border px-2 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={activeSection === "tasks" ? "新建任务" : "新建文档"}
            title={activeSection === "tasks" ? "新建任务" : "新建文档"}
            disabled={!workspace}
            onClick={activeSection === "tasks" ? onNewTask : () => onCreateDocument()}
          >
            <Icon icon={Add01Icon} size={15} />
          </Button>
          <span className="min-w-0 flex-1 truncate px-2 text-center">{workspace?.name ?? "Tessera"}</span>
          {activeSection === "files" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={layout === "tree" ? "切换到文档列表" : "切换到文件树"}
              title={layout === "tree" ? "切换到文档列表" : "切换到文件树"}
              disabled={!workspace}
              onClick={() => {
                setPane("files")
                setLayout((current) => (current === "tree" ? "list" : "tree"))
              }}
            >
              <Icon icon={layout === "tree" ? ListViewIcon : FolderTreeIcon} size={15} />
            </Button>
          ) : (
            <span className="size-7" aria-hidden="true" />
          )}
        </footer>
      </div>
    </aside>
  )
}
