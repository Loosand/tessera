/**
 * [INPUT]: 工作区、最近工作区、文档草稿与工作区操作
 * [OUTPUT]: 可收起的文件树、文档列表、大纲和工作区菜单
 * [POS]: 主应用左侧的响应式工作区导航组件
 * [DOC]: design.md、docs/architecture.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceDocumentEntry, WorkspaceInfo } from "@tessera/contracts"
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  File02Icon,
  Folder01Icon,
  FolderOpenIcon,
  FolderTreeIcon,
  Link01Icon,
  ListViewIcon,
  Menu01Icon,
  PanelLeftCloseIcon,
  PinIcon,
  Refresh01Icon,
  StarIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { useEffect, useMemo, useState } from "react"
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

interface WorkspaceSidebarProps {
  workspace: WorkspaceInfo | null
  recentWorkspaces: WorkspaceInfo[]
  documents: WorkspaceDocumentEntry[]
  activePath: string | undefined
  activeContent: string
  version: string | undefined
  onCollapse: () => void
  onSelectWorkspace: () => void
  onOpenRecentWorkspace: (workspaceId: string) => void
  onRevealWorkspace: () => void
  onRefreshDocuments: () => void
  onCreateDocument: () => void
  onOpenDocument: (relativePath: string) => void
  onSelectOutline: (index: number, line: number) => void
}

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
      className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-default disabled:opacity-45"
      data-active={active || undefined}
      disabled={disabled}
    >
      <Icon icon={icon} size={15} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
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
  workspace,
  recentWorkspaces,
  documents,
  activePath,
  activeContent,
  version,
  onCollapse,
  onSelectWorkspace,
  onOpenRecentWorkspace,
  onRevealWorkspace,
  onRefreshDocuments,
  onCreateDocument,
  onOpenDocument,
  onSelectOutline,
}: WorkspaceSidebarProps) {
  const [pane, setPane] = useState<SidebarPane>("files")
  const [layout, setLayout] = useState<FileLayout>("tree")
  const [sort, setSort] = useState<SidebarSort>("name-asc")
  const tree = useMemo(() => buildDocumentTree(documents, sort), [documents, sort])
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

  const renderTreeNode = (node: DocumentTreeNode, depth: number) => {
    if (node.document) {
      const active = node.path === activePath
      return (
        <button
          key={node.path}
          type="button"
          className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
          style={{ paddingLeft: 8 + depth * 14 }}
          data-active={active || undefined}
          onClick={() => onOpenDocument(node.path)}
        >
          <Icon icon={File02Icon} size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{documentLabel(node.name)}</span>
        </button>
      )
    }

    const expanded = expandedFolders.has(node.path)
    return (
      <div key={node.path}>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] transition-colors hover:bg-sidebar-accent"
          style={{ paddingLeft: 4 + depth * 14 }}
          aria-expanded={expanded}
          onClick={() => toggleFolder(node.path)}
        >
          <Icon
            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            size={12}
            className="text-muted-foreground"
          />
          <Icon icon={expanded ? FolderOpenIcon : Folder01Icon} size={14} className="text-muted-foreground" />
          <span className="min-w-0 truncate">{node.name}</span>
        </button>
        {expanded ? node.children.map((child) => renderTreeNode(child, depth + 1)) : null}
      </div>
    )
  }

  const workspaceMenu = workspace ? (
    <PopoverContent side="top" align="center" className="w-64 p-1.5">
      <div className="px-2 py-1.5">
        <p className="truncate text-xs font-medium">{workspace.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{workspace.rootPath}</p>
      </div>
      <div className="my-1 h-px bg-border" />
      <div className="grid gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start px-2 text-xs"
          onClick={onCreateDocument}
        >
          新建文档
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start px-2 text-xs"
          onClick={onRevealWorkspace}
        >
          在 Finder 中显示
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start px-2 text-xs"
          onClick={onSelectWorkspace}
        >
          打开其他工作区…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start gap-2 px-2 text-xs"
          onClick={onRefreshDocuments}
        >
          <Icon icon={Refresh01Icon} size={13} />
          刷新文件
        </Button>
      </div>
      <div className="my-1 h-px bg-border" />
      <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">排序</p>
      <div className="grid grid-cols-2 gap-1 px-1 pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] data-[active=true]:bg-muted"
          data-active={sort === "name-asc" || undefined}
          onClick={() => setSort("name-asc")}
        >
          名称
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] data-[active=true]:bg-muted"
          data-active={sort === "modified-desc" || undefined}
          onClick={() => setSort("modified-desc")}
        >
          最近修改
        </Button>
      </div>
      {recentWorkspaces.some((recent) => recent.id !== workspace.id) ? (
        <>
          <div className="my-1 h-px bg-border" />
          <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
            最近工作区
          </p>
          <div className="grid gap-0.5">
            {recentWorkspaces
              .filter((recent) => recent.id !== workspace.id)
              .slice(0, 6)
              .map((recent) => (
                <Button
                  key={recent.id}
                  variant="ghost"
                  size="sm"
                  className="h-8 min-w-0 justify-start px-2 text-xs"
                  title={recent.rootPath}
                  onClick={() => onOpenRecentWorkspace(recent.id)}
                >
                  <Icon icon={Folder01Icon} size={13} className="shrink-0" />
                  <span className="truncate">{recent.name}</span>
                </Button>
              ))}
          </div>
        </>
      ) : null}
      {version ? <p className="px-2 pt-1.5 text-[10px] text-muted-foreground">Tessera {version}</p> : null}
    </PopoverContent>
  ) : null

  return (
    <aside className="group/sidebar flex h-full min-h-0 w-[250px] shrink-0 flex-col bg-sidebar text-sidebar-foreground max-[760px]:w-[240px] max-[760px]:shadow-xl">
      <div className="app-drag-region relative h-12 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="app-no-drag absolute top-3 right-2 opacity-0 transition-opacity group-hover/sidebar:opacity-100 focus-visible:opacity-100 max-[760px]:opacity-100"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          onClick={onCollapse}
        >
          <Icon icon={PanelLeftCloseIcon} size={14} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2 pb-1">
        {workspace ? (
          <>
            <header className="group/view relative flex h-8 shrink-0 items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute left-0 opacity-0 transition-opacity group-hover/view:opacity-100 focus-visible:opacity-100"
                aria-label={pane === "files" ? "切换到文档大纲" : "切换到文件视图"}
                title={pane === "files" ? "切换到文档大纲" : "切换到文件视图"}
                onClick={() => setPane((current) => (current === "files" ? "outline" : "files"))}
              >
                <Icon icon={pane === "files" ? Menu01Icon : FolderTreeIcon} size={15} />
              </Button>
              <span className="text-[13px] font-medium">{pane === "outline" ? "大纲" : "文件"}</span>
            </header>

            {pane === "files" ? (
              <>
                <div className="space-y-0.5 pb-2">
                  <NavigationRow icon={PinIcon} label="已固定" count={0} disabled />
                  <NavigationRow icon={BookOpen01Icon} label="全部文档" count={documents.length} active />
                  <NavigationRow icon={StarIcon} label="收藏夹" disabled />
                  <NavigationRow icon={Link01Icon} label="关联" disabled />
                </div>
                <section className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border py-2">
                  {documents.length > 0 ? (
                    layout === "tree" ? (
                      tree.map((node) => renderTreeNode(node, 0))
                    ) : (
                      <div className="grid gap-0.5">
                        {list.map((document) => (
                          <button
                            key={document.relativePath}
                            type="button"
                            className="rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent"
                            data-active={document.relativePath === activePath || undefined}
                            onClick={() => onOpenDocument(document.relativePath)}
                          >
                            <div className="flex items-center gap-2 text-xs font-medium">
                              <span className="min-w-0 flex-1 truncate">{documentLabel(document.name)}</span>
                              <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                                {formatModifiedAt(document.modifiedAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                              {documentLocation(document.relativePath)}
                            </p>
                          </button>
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
              <section className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border py-2">
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

        <footer className="mt-auto flex h-10 shrink-0 items-center gap-1 border-t border-sidebar-border px-0.5 text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="新建文档"
            title="新建文档"
            disabled={!workspace}
            onClick={onCreateDocument}
          >
            <Icon icon={Add01Icon} size={15} />
          </Button>
          {workspace ? (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 min-w-0 flex-1 px-2 text-xs font-normal"
                    title={workspace.rootPath}
                  />
                }
              >
                <span className="truncate">{workspace.name}</span>
              </PopoverTrigger>
              {workspaceMenu}
            </Popover>
          ) : (
            <span className="min-w-0 flex-1 truncate px-2">Tessera</span>
          )}
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
        </footer>
      </div>
    </aside>
  )
}
