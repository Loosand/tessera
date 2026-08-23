/**
 * [INPUT]: 当前逐轮创作方式与用户 Skill 目录
 * [OUTPUT]: 以直接语义图标、双行说明和统一圆角层级呈现自动编排、内置/用户 Skill 与问答预设的紧凑选择器
 * [POS]: task-composer 底部工具栏中的创作方式快捷入口
 * [DOC]: design.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type BuiltInTaskSkillId, type TaskSkillId, isUserTaskSkillId } from "@tessera/contracts"
import {
  ArrowDown01Icon,
  BookOpen01Icon,
  Edit02Icon,
  Message01Icon,
  Search01Icon,
  SparklesIcon,
  Tick02Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { listBuiltInSkills } from "@tessera/skills"
import React, { useMemo, useState } from "react"
import { useUserSkills } from "../hooks/use-user-skills"

type TaskCapabilityPickerProps = Readonly<{
  skillId: TaskSkillId
  onSkillChange: (skillId: TaskSkillId) => void
}>

const BASE_TASK_SKILL_OPTIONS = [
  {
    id: null,
    displayName: "自动",
    shortDescription: "按任务动态规划与调用工具",
  },
  ...listBuiltInSkills().map((skill) => ({
    id: skill.name,
    displayName: skill.displayName,
    shortDescription: skill.name === "research" ? "搜索、阅读并核验可靠来源" : "基于材料起草、改写与润色",
  })),
  {
    id: "question-answering" as const,
    displayName: "问答",
    shortDescription: "直接回答，不主动展开研究",
  },
] satisfies readonly {
  id: TaskSkillId
  displayName: string
  shortDescription: string
}[]

const SKILL_ICONS = {
  research: Search01Icon,
  writing: Edit02Icon,
} satisfies Record<BuiltInTaskSkillId, Parameters<typeof Icon>[0]["icon"]>

function skillIcon(skillId: TaskSkillId) {
  if (skillId === null) return SparklesIcon
  if (skillId === "question-answering") return Message01Icon
  if (isUserTaskSkillId(skillId)) return BookOpen01Icon
  return SKILL_ICONS[skillId]
}

export function TaskCapabilityPicker({ skillId, onSkillChange }: TaskCapabilityPickerProps) {
  const [open, setOpen] = useState(false)
  const { skills: userSkills } = useUserSkills()
  const options = useMemo(
    () => [
      ...BASE_TASK_SKILL_OPTIONS,
      ...userSkills
        .filter((skill) => skill.enabled && skill.available)
        .map((skill) => ({
          id: skill.id as TaskSkillId,
          displayName: skill.displayName,
          shortDescription: skill.shortDescription,
        })),
    ],
    [userSkills],
  )
  const currentSkillLabel =
    options.find((option) => option.id === skillId)?.displayName ??
    userSkills.find((skill) => skill.id === skillId)?.displayName ??
    (skillId?.startsWith("user:") ? "不可用 Skill" : "自动")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 max-w-36 gap-1.5 rounded-full px-2 text-[10px] font-normal text-foreground/80 hover:bg-background/70 data-[popup-open]:bg-background/70"
            data-control="task-capability-trigger"
            aria-label={`选择创作方式，当前为${currentSkillLabel}`}
            title={`创作方式：${currentSkillLabel}`}
          />
        }
      >
        <Icon icon={skillIcon(skillId)} size={13} className="text-foreground/75" />
        <span className="truncate text-[10px] leading-none">{currentSkillLabel}</span>
        <Icon icon={ArrowDown01Icon} size={9} className="text-muted-foreground/80" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="flex max-h-[min(26rem,var(--available-height))] w-72 flex-col overflow-hidden rounded-2xl border border-border/70 p-1.5 shadow-[0_18px_50px_-28px_color-mix(in_oklch,var(--foreground)_42%,transparent)] ring-0"
      >
        <header className="shrink-0 px-2.5 pt-1.5 pb-2">
          <h2 className="text-[11px] font-medium">创作方式</h2>
          <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">决定这一轮如何处理请求</p>
        </header>
        <section className="min-h-0 overflow-y-auto" aria-label="创作方式">
          <div className="grid gap-0.5">
            {options.map((option) => {
              const selected = skillId === option.id
              return (
                <Button
                  key={option.id ?? "auto"}
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start gap-2.5 rounded-xl px-2.5 py-1.5 text-left font-normal data-[selected=true]:bg-muted/75"
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  onClick={() => {
                    onSkillChange(option.id)
                    setOpen(false)
                  }}
                >
                  <Icon
                    icon={skillIcon(option.id)}
                    size={15}
                    className={selected ? "shrink-0 text-foreground" : "shrink-0 text-muted-foreground"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] leading-4 font-medium">
                      {option.displayName}
                    </span>
                    <span className="block truncate text-[9px] leading-3.5 text-muted-foreground">
                      {option.shortDescription}
                    </span>
                  </span>
                  {selected ? (
                    <Icon icon={Tick02Icon} size={12} className="shrink-0 text-foreground/70" />
                  ) : null}
                </Button>
              )
            })}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  )
}
