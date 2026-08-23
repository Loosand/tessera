/**
 * [INPUT]: 内置 Skill 注册表、用户 Skill 单目录导入/扫描安装 Hook、侧栏状态与按 Skill 创建任务回调
 * [OUTPUT]: 支持单目录导入、递归扫描预览/批量安装、搜索、Sheet 详情、启停、删除和权限检查的本地 Skill 管理页
 * [POS]: 一级导航中的 Skill 安装管理与任务入口
 * [DOC]: design.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  BuiltInTaskSkillId,
  UserSkillConfig,
  UserSkillScan,
  UserSkillScanCandidateStatus,
  UserTaskSkillId,
} from "@tessera/contracts"
import {
  AiWebBrowsingIcon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Edit02Icon,
  FolderAddIcon,
  FolderSearchIcon,
  InformationCircleIcon,
  PanelLeftOpenIcon,
  Search01Icon,
  Shield01Icon,
  SourceCodeIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@tessera/design-system/components/ui/dialog"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@tessera/design-system/components/ui/sheet"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { type SkillPermission, listBuiltInSkills } from "@tessera/skills"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useUserSkills } from "../hooks/use-user-skills"

type SelectableSkillId = BuiltInTaskSkillId | UserTaskSkillId

type SkillManagementPageProps = Readonly<{
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onUseSkill: (skillId: SelectableSkillId) => void
}>

type CatalogSkill = Readonly<{
  available: boolean
  description: string
  displayName: string
  enabled: boolean
  error?: string
  id: SelectableSkillId
  kind: "built-in" | "user"
  name: string
  permissions: readonly SkillPermission[]
  root: string
  shortDescription: string
  userConfig?: UserSkillConfig
}>

const BUILT_IN_SKILLS = listBuiltInSkills()
const BUILT_IN_ICONS = {
  research: AiWebBrowsingIcon,
  writing: Edit02Icon,
} satisfies Record<BuiltInTaskSkillId, Parameters<typeof Icon>[0]["icon"]>

const PERMISSION_LABELS: Record<string, string> = {
  "network.search": "联网搜索",
  "workspace.read": "读取 Markdown",
  "workspace.write": "修改 Markdown",
}

const EFFECT_LABELS: Record<SkillPermission["effect"], string> = {
  allow: "允许",
  ask: "使用时确认",
  deny: "禁止",
}

const SCAN_STATUS_LABELS: Record<UserSkillScanCandidateStatus, string> = {
  ready: "可安装",
  installed: "已安装",
  conflict: "名称冲突",
  invalid: "无效",
}

function skillIcon(skill: CatalogSkill) {
  return skill.kind === "user" ? BookOpen01Icon : BUILT_IN_ICONS[skill.name as BuiltInTaskSkillId]
}

function matchesQuery(skill: CatalogSkill, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN")
  if (!query) return true
  return [skill.displayName, skill.name, skill.description, skill.shortDescription]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(query)
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}

function SkillCard({
  active,
  skill,
  onSelect,
  onToggle,
}: {
  active: boolean
  skill: CatalogSkill
  onSelect: () => void
  onToggle: (enabled: boolean) => void
}) {
  return (
    <article
      className="flex min-h-50 flex-col rounded-xl border border-border bg-background transition-[border-color,background-color,box-shadow] hover:border-foreground/20 data-[active=true]:border-foreground/25 data-[active=true]:bg-muted/45 data-[active=true]:shadow-xs"
      data-active={active || undefined}
    >
      <button
        type="button"
        className="flex flex-1 flex-col p-4 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-expanded={active}
        aria-haspopup="dialog"
        onClick={onSelect}
      >
        <span className="flex w-full items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon icon={skillIcon(skill)} size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{skill.displayName}</span>
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {skill.kind === "built-in" ? "内置" : "用户"}
              </span>
            </span>
            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">${skill.name}</span>
          </span>
          {skill.available ? (
            <Icon icon={CheckmarkCircle02Icon} size={13} className="text-muted-foreground" />
          ) : (
            <Icon icon={InformationCircleIcon} size={13} className="text-destructive" />
          )}
        </span>
        <span className="mt-4 block text-xs leading-5 text-muted-foreground">{skill.shortDescription}</span>
      </button>

      <div className="flex min-h-10 items-center justify-between gap-3 border-t border-border/70 px-4 py-2">
        <span className="flex flex-wrap gap-1.5">
          {skill.permissions.length > 0 ? (
            skill.permissions.slice(0, 2).map((permission) => (
              <span
                key={`${permission.action}:${permission.resource}`}
                className="rounded-md bg-muted px-1.5 py-1 text-[9px] text-muted-foreground"
              >
                {PERMISSION_LABELS[permission.action] ?? permission.action}
              </span>
            ))
          ) : (
            <span className="text-[9px] text-muted-foreground">仅 instructions</span>
          )}
        </span>
        {skill.kind === "user" ? (
          <Switch
            size="sm"
            checked={skill.enabled}
            disabled={!skill.available && !skill.enabled}
            aria-label={`${skill.enabled ? "停用" : "启用"}${skill.displayName}`}
            onCheckedChange={onToggle}
          />
        ) : (
          <span className="text-[9px] text-muted-foreground">已启用</span>
        )}
      </div>
    </article>
  )
}

function SkillPermissions({ skill }: { skill: CatalogSkill }) {
  if (skill.permissions.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-background px-3 py-3 text-[11px] leading-5 text-muted-foreground">
        用户 Skill 只注入 instructions，不声明也不会获得新的联网、文件、Shell 或 MCP 权限。
      </div>
    )
  }
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background">
      {skill.permissions.map((permission, index) => (
        <div
          key={`${permission.action}:${permission.resource}`}
          className="flex items-center justify-between gap-3 px-3 py-2.5 text-[11px] data-[border=true]:border-t data-[border=true]:border-border"
          data-border={index > 0 || undefined}
        >
          <span className="min-w-0">
            <span className="block font-medium">
              {PERMISSION_LABELS[permission.action] ?? permission.action}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
              {permission.resource}
            </span>
          </span>
          <span className="shrink-0 text-muted-foreground">{EFFECT_LABELS[permission.effect]}</span>
        </div>
      ))}
    </div>
  )
}

function SkillDetail({
  skill,
  onDelete,
  onUseSkill,
}: {
  skill: CatalogSkill
  onDelete: (skill: CatalogSkill) => void
  onUseSkill: (skillId: SelectableSkillId) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-5">
        <div className="flex items-center gap-3 pr-10">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon icon={skillIcon(skill)} size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">{skill.displayName}</SheetTitle>
            <p className="font-mono text-[10px] text-muted-foreground">${skill.name}</p>
          </div>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-[9px] text-muted-foreground">
            {skill.kind === "built-in" ? "内置" : "用户"}
          </span>
        </div>

        <SheetDescription className="mt-4">{skill.description}</SheetDescription>
        {skill.error ? (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[10px] leading-4 text-destructive">
            {skill.error}
          </p>
        ) : null}

        <section className="mt-6">
          <h3 className="flex items-center gap-1.5 text-xs font-medium">
            <Icon icon={Shield01Icon} size={14} />
            权限边界
          </h3>
          <SkillPermissions skill={skill} />
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            声明只描述所需能力，不会自动授予联网或文件权限。
          </p>
        </section>

        <section className="mt-6">
          <h3 className="flex items-center gap-1.5 text-xs font-medium">
            <Icon icon={SourceCodeIcon} size={14} />
            加载方式
          </h3>
          <ol className="mt-2 grid gap-2 text-[11px] leading-4 text-muted-foreground">
            <li>1. 目录中必须有标准 SKILL.md。</li>
            <li>2. 安装时复制到 Tessera 托管目录并限制文件体积。</li>
            <li>3. 任务开始前再次校验，只注入当前 Skill 正文。</li>
            <li>4. 附带脚本不会自动执行。</li>
          </ol>
        </section>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-6 py-4">
        <div className="mb-3 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
          <span>{skill.kind === "built-in" ? "Tessera 内置" : "Tessera 托管"}</span>
          {skill.userConfig ? (
            <span>
              {skill.userConfig.fileCount} 个文件 · {formatBytes(skill.userConfig.totalBytes)}
            </span>
          ) : (
            <span className="truncate font-mono" title={skill.root}>
              {skill.root}
            </span>
          )}
        </div>
        <Button
          className="w-full"
          disabled={!skill.enabled || !skill.available}
          onClick={() => onUseSkill(skill.id)}
        >
          使用“{skill.displayName}”新建任务
        </Button>
        {skill.kind === "user" ? (
          <Button className="mt-2 w-full" variant="destructive" onClick={() => onDelete(skill)}>
            <Icon icon={Delete02Icon} size={14} />
            删除用户 Skill
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function SkillScanDialog({
  busy,
  onClose,
  onInstall,
  scan,
}: {
  busy: boolean
  onClose: () => void
  onInstall: (candidateIds: string[]) => void
  scan: UserSkillScan | null
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const readyIds = useMemo(
    () =>
      scan?.candidates.filter((candidate) => candidate.status === "ready").map((candidate) => candidate.id) ??
      [],
    [scan],
  )

  useEffect(() => setSelectedIds(readyIds), [readyIds])

  const toggleCandidate = (candidateId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, candidateId] : current.filter((id) => id !== candidateId),
    )
  }

  return (
    <Dialog
      open={Boolean(scan)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[76vh] max-w-2xl overflow-hidden p-0" initialFocus={false}>
        <div className="border-b border-border px-5 py-4">
          <DialogTitle>扫描到的 Skill</DialogTitle>
          <DialogDescription>
            {scan
              ? `已检查“${scan.rootName}”下 ${scan.scannedDirectoryCount} 个目录；选择要复制到 Tessera 托管目录的项目。`
              : "扫描只读取目录，不会执行脚本。"}
          </DialogDescription>
        </div>

        <div className="max-h-[48vh] overflow-y-auto px-5 py-4">
          {scan?.truncated ? (
            <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-[11px] leading-4 text-destructive">
              扫描已达到安全上限，结果可能不完整。请缩小目录范围后重新扫描。
            </p>
          ) : null}
          {scan && scan.candidates.length > 0 ? (
            <div className="grid gap-2">
              {scan.candidates.map((candidate) => {
                const selectable = candidate.status === "ready"
                const checked = selectedIds.includes(candidate.id)
                return (
                  <label
                    key={candidate.id}
                    className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 data-[selectable=true]:cursor-pointer data-[selectable=true]:hover:bg-muted/40"
                    data-selectable={selectable || undefined}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-foreground"
                      aria-label={`选择 ${candidate.displayName}`}
                      checked={checked}
                      disabled={!selectable || busy}
                      onChange={(event) => toggleCandidate(candidate.id, event.currentTarget.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{candidate.displayName}</span>
                        {candidate.name ? (
                          <span className="font-mono text-[9px] text-muted-foreground">
                            ${candidate.name}
                          </span>
                        ) : null}
                        <span
                          className="rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground data-[status=ready]:border-foreground/20 data-[status=ready]:text-foreground"
                          data-status={candidate.status}
                        >
                          {SCAN_STATUS_LABELS[candidate.status]}
                        </span>
                      </span>
                      {candidate.description ? (
                        <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                          {candidate.description}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                        {candidate.relativePath}
                      </span>
                      {candidate.error ? (
                        <span className="mt-1 block text-[10px] leading-4 text-destructive">
                          {candidate.error}
                        </span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-medium">没有发现 SKILL.md</p>
              <p className="mt-1 text-xs text-muted-foreground">
                请选择包含一个或多个 Skill 目录的上级文件夹。
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={readyIds.length === 0 || busy}
            onClick={() => setSelectedIds(selectedIds.length === readyIds.length ? [] : readyIds)}
          >
            {selectedIds.length === readyIds.length && readyIds.length > 0 ? "取消全选" : "选择全部可安装项"}
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button disabled={selectedIds.length === 0 || busy} onClick={() => onInstall(selectedIds)}>
              {busy ? "正在安装" : `安装 ${selectedIds.length} 个 Skill`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SkillManagementPage({ sidebarOpen, onToggleSidebar, onUseSkill }: SkillManagementPageProps) {
  const pageRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState("")
  const [selectedSkillId, setSelectedSkillId] = useState<SelectableSkillId>("research")
  const [detailOpen, setDetailOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<"install" | "scan" | "batch" | null>(null)
  const {
    busy,
    clearScan,
    error,
    install,
    installScanned,
    loading,
    remove,
    scanDirectory,
    scanResult,
    setEnabled,
    skills: userSkills,
  } = useUserSkills()
  const catalog = useMemo<CatalogSkill[]>(
    () => [
      ...BUILT_IN_SKILLS.map((skill) => ({
        available: true,
        description: skill.description,
        displayName: skill.displayName,
        enabled: true,
        id: skill.name,
        kind: "built-in" as const,
        name: skill.name,
        permissions: skill.permissions,
        root: skill.root,
        shortDescription: skill.shortDescription,
      })),
      ...userSkills.map((skill) => ({
        available: skill.available,
        description: skill.description,
        displayName: skill.displayName,
        enabled: skill.enabled,
        ...(skill.error ? { error: skill.error } : {}),
        id: skill.id,
        kind: "user" as const,
        name: skill.name,
        permissions: [],
        root: `user://${skill.name}`,
        shortDescription: skill.shortDescription,
        userConfig: skill,
      })),
    ],
    [userSkills],
  )
  const filteredSkills = catalog.filter((skill) => matchesQuery(skill, query))
  const selectedSkill = catalog.find((skill) => skill.id === selectedSkillId)

  return (
    <section ref={pageRef} className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="app-drag-region window-titlebar-leading relative flex h-12 shrink-0 items-center pr-3"
        data-sidebar-open={sidebarOpen}
      >
        <div className="app-no-drag flex min-w-8 items-center">
          {!sidebarOpen ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              onClick={onToggleSidebar}
            >
              <Icon icon={PanelLeftOpenIcon} size={15} />
            </Button>
          ) : null}
        </div>
        <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium">
          技能
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">技能</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                安装自己的本地工作流，并检查它们实际拥有的能力边界。
              </p>
            </div>
            <div className="flex max-w-full items-center gap-2">
              <label className="relative block w-56 max-w-full" htmlFor="skill-search">
                <span className="sr-only">搜索技能</span>
                <Icon
                  icon={Search01Icon}
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="skill-search"
                  type="search"
                  value={query}
                  className="pl-8"
                  placeholder="搜索技能"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPendingAction("scan")
                  void scanDirectory().finally(() => setPendingAction(null))
                }}
              >
                <Icon icon={FolderSearchIcon} size={14} />
                {pendingAction === "scan" ? "正在扫描" : "扫描 Skill"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setPendingAction("install")
                  void install()
                    .then((skill) => {
                      if (skill) {
                        setSelectedSkillId(skill.id)
                        setDetailOpen(true)
                      }
                    })
                    .finally(() => setPendingAction(null))
                }}
              >
                <Icon icon={FolderAddIcon} size={14} />
                {pendingAction === "install" ? "正在导入" : "添加 Skill"}
              </Button>
            </div>
          </div>

          <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background shadow-xs">
                <Icon icon={BookOpen01Icon} size={16} />
              </span>
              <div>
                <h2 className="text-xs font-medium">已安装 {catalog.length} 个 Skill</h2>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {loading
                    ? "正在读取用户 Skill…"
                    : `${BUILT_IN_SKILLS.length} 个内置 · ${userSkills.length} 个用户 Skill`}
                </p>
              </div>
            </div>
            <span className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">
              本地托管
            </span>
          </section>

          {error ? (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <section className="mt-6" aria-labelledby="installed-skills-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="installed-skills-title" className="text-sm font-medium">
                已安装
              </h2>
              <span className="text-[10px] text-muted-foreground">{filteredSkills.length} 个结果</span>
            </div>

            {filteredSkills.length > 0 ? (
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                {filteredSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    active={detailOpen && selectedSkill?.id === skill.id}
                    onSelect={() => {
                      setSelectedSkillId(skill.id)
                      setDetailOpen(true)
                    }}
                    onToggle={(enabled) => void setEnabled(skill.id as UserTaskSkillId, enabled)}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-12 text-center">
                <p className="text-sm font-medium">没有匹配的 Skill</p>
                <p className="mt-1 text-xs text-muted-foreground">换个关键词，或从本地文件夹添加。</p>
              </div>
            )}
          </section>
        </div>
      </div>
      <Sheet open={detailOpen && Boolean(selectedSkill)} onOpenChange={setDetailOpen}>
        <SheetContent container={pageRef}>
          {selectedSkill ? (
            <SkillDetail
              skill={selectedSkill}
              onUseSkill={(skillId) => {
                setDetailOpen(false)
                onUseSkill(skillId)
              }}
              onDelete={(skill) => {
                if (!window.confirm(`删除用户 Skill“${skill.displayName}”？托管副本会移到废纸篓。`)) {
                  return
                }
                void remove(skill.id as UserTaskSkillId).then((removed) => {
                  if (removed) {
                    setDetailOpen(false)
                    setSelectedSkillId("research")
                  }
                })
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <SkillScanDialog
        scan={scanResult}
        busy={busy && pendingAction === "batch"}
        onClose={clearScan}
        onInstall={(candidateIds) => {
          if (!scanResult) return
          setPendingAction("batch")
          void installScanned(scanResult.id, candidateIds)
            .then((result) => {
              const firstInstalled = result?.ok ? result.skills[0] : null
              if (firstInstalled) {
                setSelectedSkillId(firstInstalled.id)
                setDetailOpen(true)
              }
            })
            .finally(() => setPendingAction(null))
        }}
      />
    </section>
  )
}
