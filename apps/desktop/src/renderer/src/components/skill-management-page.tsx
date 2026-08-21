/**
 * [INPUT]: 内置 Skill 注册表、侧栏状态与按 Skill 创建任务回调
 * [OUTPUT]: 可搜索、选择和检查权限声明的本地 Skill 管理页
 * [POS]: 一级导航中的 Skill 管理与任务入口
 * [DOC]: design.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { BuiltInTaskSkillId } from "@tessera/contracts"
import {
  AiWebBrowsingIcon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  PanelLeftOpenIcon,
  Search01Icon,
  Shield01Icon,
  SourceCodeIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { type BuiltInSkillDescriptor, type SkillPermission, listBuiltInSkills } from "@tessera/skills"
import React, { useState } from "react"

interface SkillManagementPageProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onUseSkill: (skillId: BuiltInTaskSkillId) => void
}

const BUILT_IN_SKILLS = listBuiltInSkills()

const SKILL_ICONS = {
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

function matchesQuery(skill: BuiltInSkillDescriptor, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN")
  if (!query) return true
  return [skill.displayName, skill.name, skill.description, skill.shortDescription]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(query)
}

function SkillCard({
  active,
  skill,
  onSelect,
}: {
  active: boolean
  skill: BuiltInSkillDescriptor
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className="group flex min-h-50 w-full flex-col rounded-xl border border-border bg-background p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-foreground/20 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:border-foreground/25 data-[active=true]:bg-muted/45 data-[active=true]:shadow-xs"
      data-active={active || undefined}
      aria-pressed={active}
      onClick={onSelect}
    >
      <div className="flex w-full items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon icon={SKILL_ICONS[skill.name]} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{skill.displayName}</span>
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              内置
            </span>
          </span>
          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">${skill.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Icon icon={CheckmarkCircle02Icon} size={12} />
          已启用
        </span>
      </div>

      <span className="mt-4 block text-xs leading-5 text-muted-foreground">{skill.shortDescription}</span>

      <span className="mt-auto flex flex-wrap gap-1.5 pt-5">
        {skill.permissions.map((permission) => (
          <span
            key={`${permission.action}:${permission.resource}`}
            className="rounded-md bg-muted px-1.5 py-1 text-[10px] text-muted-foreground"
          >
            {PERMISSION_LABELS[permission.action] ?? permission.action}
          </span>
        ))}
      </span>
    </button>
  )
}

function SkillDetail({
  skill,
  onUseSkill,
}: {
  skill: BuiltInSkillDescriptor
  onUseSkill: (skillId: BuiltInTaskSkillId) => void
}) {
  return (
    <aside className="rounded-xl border border-border bg-muted/20 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background shadow-xs">
          <Icon icon={SKILL_ICONS[skill.name]} size={19} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{skill.displayName}</h2>
          <p className="font-mono text-[10px] text-muted-foreground">${skill.name}</p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">{skill.description}</p>

      <section className="mt-6">
        <h3 className="flex items-center gap-1.5 text-xs font-medium">
          <Icon icon={Shield01Icon} size={14} />
          权限声明
        </h3>
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
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          声明只描述所需能力，不会自动授予联网或文件权限。
        </p>
      </section>

      <section className="mt-6">
        <h3 className="flex items-center gap-1.5 text-xs font-medium">
          <Icon icon={SourceCodeIcon} size={14} />
          模型加载
        </h3>
        <ol className="mt-2 grid gap-2 text-[11px] leading-4 text-muted-foreground">
          <li>1. 选择器只读取常驻元数据。</li>
          <li>2. 任务开始时按需校验对应 SKILL.md。</li>
          <li>3. 仅将当前 Skill 正文注入本轮模型指令。</li>
        </ol>
      </section>

      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
          <span>Tessera 内置</span>
          <span className="truncate font-mono" title={skill.root}>
            {skill.root}
          </span>
        </div>
        <Button className="w-full" onClick={() => onUseSkill(skill.name)}>
          使用“{skill.displayName}”新建任务
        </Button>
      </div>
    </aside>
  )
}

export function SkillManagementPage({ sidebarOpen, onToggleSidebar, onUseSkill }: SkillManagementPageProps) {
  const [query, setQuery] = useState("")
  const [selectedSkillId, setSelectedSkillId] = useState<BuiltInTaskSkillId>("research")
  const filteredSkills = BUILT_IN_SKILLS.filter((skill) => matchesQuery(skill, query))
  const selectedSkill = filteredSkills.find((skill) => skill.name === selectedSkillId) ?? filteredSkills[0]

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
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
                管理模型可按需加载的本地工作流，并检查它们声明的能力边界。
              </p>
            </div>
            <label className="relative block w-64 max-w-full" htmlFor="skill-search">
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
          </div>

          <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background shadow-xs">
                <Icon icon={BookOpen01Icon} size={16} />
              </span>
              <div>
                <h2 className="text-xs font-medium">已安装 {BUILT_IN_SKILLS.length} 个 Skill</h2>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  当前内置 Skill 随应用启用，用户级与工作区级安装正在规划。
                </p>
              </div>
            </div>
            <span className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">
              本地基建
            </span>
          </section>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5 max-[900px]:grid-cols-1">
            <section aria-labelledby="installed-skills-title">
              <div className="flex items-center justify-between gap-3">
                <h2 id="installed-skills-title" className="text-sm font-medium">
                  已安装
                </h2>
                <span className="text-[10px] text-muted-foreground">{filteredSkills.length} 个结果</span>
              </div>

              {filteredSkills.length > 0 ? (
                <div className="mt-3 grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                  {filteredSkills.map((skill) => (
                    <SkillCard
                      key={skill.name}
                      skill={skill}
                      active={selectedSkill?.name === skill.name}
                      onSelect={() => setSelectedSkillId(skill.name)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-12 text-center">
                  <p className="text-sm font-medium">没有匹配的 Skill</p>
                  <p className="mt-1 text-xs text-muted-foreground">尝试搜索“研究”或“写作”。</p>
                </div>
              )}
            </section>

            {selectedSkill ? <SkillDetail skill={selectedSkill} onUseSkill={onUseSkill} /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}
