/**
 * [INPUT]: 当前逐轮创作模式、生成状态与用户 Skill 目录
 * [OUTPUT]: 只暴露自动、内置/用户 Skill 与问答意图的紧凑模式选择器
 * [POS]: task-composer 底部工具栏中的按需能力入口
 * [DOC]: design.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type BuiltInTaskSkillId, type TaskSkillId, isUserTaskSkillId } from "@tessera/contracts"
import {
  AiBrain01Icon,
  AiWebBrowsingIcon,
  ArrowDown01Icon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  Message01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { listBuiltInSkills } from "@tessera/skills"
import React, { useMemo, useState } from "react"
import { useUserSkills } from "../hooks/use-user-skills"

type TaskCapabilityPickerProps = Readonly<{
  running: boolean
  skillId: TaskSkillId
  onSkillChange: (skillId: TaskSkillId) => void
}>

const BASE_TASK_SKILL_OPTIONS = [
  {
    id: null,
    displayName: "自动",
    shortDescription: "根据工作区和模型能力自动使用完整工具",
  },
  ...listBuiltInSkills().map((skill) => ({
    id: skill.name,
    displayName: skill.displayName,
    shortDescription:
      skill.name === "research" ? "深度推理、联网核验并形成研究计划" : "深度推理、阅读材料并产出可审查修改",
  })),
  {
    id: "question-answering" as const,
    displayName: "问答",
    shortDescription: "不联网，直接使用当前对话与附件回答",
  },
] satisfies readonly {
  id: TaskSkillId
  displayName: string
  shortDescription: string
}[]

const SKILL_ICONS = {
  research: AiWebBrowsingIcon,
  writing: Edit02Icon,
} satisfies Record<BuiltInTaskSkillId, Parameters<typeof Icon>[0]["icon"]>

function skillIcon(skillId: TaskSkillId) {
  if (skillId === null) return AiBrain01Icon
  if (skillId === "question-answering") return Message01Icon
  if (isUserTaskSkillId(skillId)) return BookOpen01Icon
  return SKILL_ICONS[skillId]
}

export function TaskCapabilityPicker({ running, skillId, onSkillChange }: TaskCapabilityPickerProps) {
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
            variant={skillId !== null ? "secondary" : "ghost"}
            size="sm"
            className="h-7 max-w-24 gap-1 rounded-full px-2 font-normal data-[popup-open]:bg-muted"
            aria-label={`选择创作模式，当前为${currentSkillLabel}`}
            title={`创作模式：${currentSkillLabel}`}
          />
        }
      >
        <Icon icon={skillIcon(skillId)} size={15} />
        <span className="truncate text-[11px]">{currentSkillLabel}</span>
        <Icon icon={ArrowDown01Icon} size={11} className="text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 rounded-xl border border-border/70 p-1.5 shadow-[0_18px_50px_-28px_color-mix(in_oklch,var(--foreground)_42%,transparent)] ring-0"
      >
        <header className="px-2 pt-1.5 pb-2">
          <h2 className="text-[13px] font-medium">创作模式</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">模式会自动安排联网、思考与工作区工具。</p>
        </header>

        <section aria-labelledby="task-skill-options-title">
          <h3
            id="task-skill-options-title"
            className="px-2 py-1 text-[10px] font-medium text-muted-foreground"
          >
            选择方式
          </h3>
          <div className="grid gap-0.5">
            {options.map((option) => {
              const selected = skillId === option.id
              return (
                <Button
                  key={option.id ?? "auto"}
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left font-normal data-[selected=true]:bg-muted/65"
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  disabled={running}
                  onClick={() => {
                    onSkillChange(option.id)
                    setOpen(false)
                  }}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon icon={skillIcon(option.id)} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium">{option.displayName}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {option.shortDescription}
                    </span>
                  </span>
                  {selected ? (
                    <Icon icon={CheckmarkCircle02Icon} size={14} className="shrink-0 text-foreground" />
                  ) : null}
                </Button>
              )
            })}
          </div>
        </section>

        <p className="border-t border-border px-2 pt-2 pb-1 text-[9px] leading-4 text-muted-foreground">
          文件写入仍会逐次展示 Diff，并只在你明确批准后执行。
        </p>
      </PopoverContent>
    </Popover>
  )
}
