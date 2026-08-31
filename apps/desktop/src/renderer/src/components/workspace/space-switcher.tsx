/**
 * [INPUT]: 当前可空文件工作区、最近工作区与 Space 切换、选择和最近目录操作
 * [OUTPUT]: 固定包含不可删除“默认空间”的紧凑 Space 选择菜单及文件 Space 右键命令
 * [POS]: 应用内嵌侧栏顶部的空间导航入口
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceInfo } from "@tessera/contracts"
import {
  Add01Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Folder01Icon,
  Home05Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { useState } from "react"
import { WorkspaceContextMenu } from "./workspace-context-menu"

type SpaceSwitcherProps = Readonly<{
  workspace: WorkspaceInfo | null
  workspaces: readonly WorkspaceInfo[]
  onCopyWorkspacePath: (workspaceId: string) => void
  onOpenDefault: () => void
  onOpenWorkspace: (workspaceId: string) => void
  onRemoveWorkspace: (workspaceId: string) => void
  onRevealWorkspace: (workspaceId: string) => void
  onSelectWorkspace: () => void
}>

type SpaceRowProps = Readonly<{
  active: boolean
  icon: Parameters<typeof Icon>[0]["icon"]
  label: string
  onClick: () => void
}>

function SpaceRow({ active, icon, label, onClick }: SpaceRowProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-9 w-full justify-start gap-2 rounded-xl px-2.5 font-normal data-[active=true]:bg-muted"
      data-active={active || undefined}
      onClick={onClick}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted/80">
        <Icon icon={icon} size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-[12px]">{label}</span>
      {active ? <Icon icon={CheckmarkCircle02Icon} size={14} className="shrink-0" /> : null}
    </Button>
  )
}

export function SpaceSwitcher({
  workspace,
  workspaces,
  onCopyWorkspacePath,
  onOpenDefault,
  onOpenWorkspace,
  onRemoveWorkspace,
  onRevealWorkspace,
  onSelectWorkspace,
}: SpaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="app-no-drag h-9 min-w-0 flex-1 justify-start gap-2 rounded-xl px-2.5 font-medium hover:bg-sidebar-accent data-[popup-open]:bg-sidebar-accent"
            aria-label="切换空间"
          />
        }
      >
        <Icon icon={workspace ? Folder01Icon : Home05Icon} size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left text-[12px]">{workspace?.name ?? "默认空间"}</span>
        <Icon icon={ArrowDown01Icon} size={12} className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-64 rounded-2xl border border-border/70 p-1.5 ring-0"
      >
        <div className="px-2 pt-1 pb-1.5 text-[10px] font-medium text-muted-foreground">空间</div>
        <div className="grid gap-0.5">
          <SpaceRow
            active={!workspace}
            icon={Home05Icon}
            label="默认空间"
            onClick={() => choose(onOpenDefault)}
          />
          {workspaces.map((candidate) => (
            <WorkspaceContextMenu
              key={candidate.id}
              workspace={candidate}
              trigger={
                <SpaceRow
                  active={candidate.id === workspace?.id}
                  icon={Folder01Icon}
                  label={candidate.name}
                  onClick={() => choose(() => onOpenWorkspace(candidate.id))}
                />
              }
              onCopyPath={onCopyWorkspacePath}
              onOpen={(workspaceId) => choose(() => onOpenWorkspace(workspaceId))}
              onRemove={onRemoveWorkspace}
              onReveal={onRevealWorkspace}
            />
          ))}
        </div>
        <div className="mt-1 border-t border-border/70 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-2 rounded-xl px-2.5 font-normal"
            onClick={() => choose(onSelectWorkspace)}
          >
            <Icon icon={Add01Icon} size={14} />
            <span className="text-[12px]">打开文件工作区…</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
