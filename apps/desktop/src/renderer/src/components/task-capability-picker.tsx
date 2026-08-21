/**
 * [INPUT]: 当前 Skill、联网/思考状态、模型能力与任务锁定边界
 * [OUTPUT]: 将对话方式和低频 AI 能力集中呈现的紧凑悬浮选择器
 * [POS]: task-composer 底部工具栏中的按需能力入口
 * [DOC]: design.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatReasoning, BuiltInTaskSkillId, TaskSkillId } from "@tessera/contracts"
import {
  AiBrain01Icon,
  AiWebBrowsingIcon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  Message01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { listBuiltInSkills } from "@tessera/skills"
import React, { useState } from "react"

type TaskCapabilityPickerProps = Readonly<{
  reasoning: AiChatReasoning
  running: boolean
  skillId: TaskSkillId
  skillLocked: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
  webSearch: boolean
  onReasoningChange: (reasoning: AiChatReasoning) => void
  onSkillChange: (skillId: TaskSkillId) => void
  onWebSearchChange: (enabled: boolean) => void
}>

const REASONING_OPTIONS = [
  { id: "auto", label: "自动思考" },
  { id: "none", label: "不思考" },
  { id: "low", label: "简短思考" },
  { id: "medium", label: "深入思考" },
  { id: "high", label: "充分思考" },
] as const satisfies readonly { readonly id: AiChatReasoning; readonly label: string }[]

const TASK_SKILL_OPTIONS = [
  {
    id: null,
    displayName: "问答",
    shortDescription: "直接回答，不加载内置 Skill",
  },
  ...listBuiltInSkills().map((skill) => ({
    id: skill.name,
    displayName: skill.displayName,
    shortDescription: skill.shortDescription,
  })),
] satisfies readonly {
  id: TaskSkillId
  displayName: string
  shortDescription: string
}[]

const SKILL_ICONS = {
  research: AiWebBrowsingIcon,
  writing: Edit02Icon,
} satisfies Record<BuiltInTaskSkillId, Parameters<typeof Icon>[0]["icon"]>

function isAiChatReasoning(value: unknown): value is AiChatReasoning {
  return typeof value === "string" && REASONING_OPTIONS.some((option) => option.id === value)
}

function skillIcon(skillId: TaskSkillId) {
  return skillId === null ? Message01Icon : SKILL_ICONS[skillId]
}

function skillLabel(skillId: TaskSkillId) {
  return TASK_SKILL_OPTIONS.find((option) => option.id === skillId)?.displayName ?? "问答"
}

export function TaskCapabilityPicker({
  reasoning,
  running,
  skillId,
  skillLocked,
  supportsReasoning,
  supportsSearch,
  webSearch,
  onReasoningChange,
  onSkillChange,
  onWebSearchChange,
}: TaskCapabilityPickerProps) {
  const [open, setOpen] = useState(false)
  const activeCapability = skillId !== null || webSearch || reasoning !== "auto"
  const currentSkillLabel = skillLabel(skillId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={activeCapability ? "secondary" : "ghost"}
            size="sm"
            className="h-7 max-w-24 gap-1 rounded-full px-2 font-normal data-[popup-open]:bg-muted"
            aria-label={`打开对话能力，当前为${currentSkillLabel}`}
            title={`对话能力：${currentSkillLabel}`}
          />
        }
      >
        <Icon icon={AiBrain01Icon} size={15} />
        {skillId !== null ? <span className="truncate text-[11px]">{currentSkillLabel}</span> : null}
        <Icon icon={ArrowDown01Icon} size={11} className="text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-80 rounded-xl border border-border/70 p-1.5 shadow-[0_18px_50px_-28px_color-mix(in_oklch,var(--foreground)_42%,transparent)] ring-0"
      >
        <header className="px-2 pt-1.5 pb-2">
          <h2 className="text-[13px] font-medium">对话能力</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">只在需要时展开，不占用常驻输入空间。</p>
        </header>

        <section aria-labelledby="task-skill-options-title">
          <h3
            id="task-skill-options-title"
            className="px-2 py-1 text-[10px] font-medium text-muted-foreground"
          >
            对话方式
          </h3>
          <div className="grid gap-0.5">
            {TASK_SKILL_OPTIONS.map((option) => {
              const selected = skillId === option.id
              return (
                <Button
                  key={option.id ?? "question-answering"}
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left font-normal data-[selected=true]:bg-muted/65"
                  data-selected={selected || undefined}
                  aria-pressed={selected}
                  disabled={skillLocked || running}
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

        <section className="mt-1 border-t border-border pt-1" aria-labelledby="task-low-frequency-title">
          <h3
            id="task-low-frequency-title"
            className="px-2 py-1 text-[10px] font-medium text-muted-foreground"
          >
            本轮设置
          </h3>

          <div className="flex min-h-10 items-center gap-3 rounded-lg px-2 py-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon icon={AiWebBrowsingIcon} size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium">联网搜索</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {supportsSearch ? "允许 Chat 查询外部来源" : "当前模式或模型不支持"}
              </span>
            </span>
            <Switch
              size="sm"
              checked={webSearch}
              disabled={!supportsSearch || running}
              aria-label="联网搜索"
              onCheckedChange={onWebSearchChange}
            />
          </div>

          <div className="flex min-h-10 items-center gap-3 rounded-lg px-2 py-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon icon={AiBrain01Icon} size={14} />
            </span>
            <label className="min-w-0 flex-1 text-[12px] font-medium" htmlFor="task-reasoning-level">
              思考强度
            </label>
            <NativeSelect
              id="task-reasoning-level"
              size="sm"
              value={reasoning}
              className="max-w-28 border-0 bg-muted/60 text-[11px]"
              disabled={!supportsReasoning || running}
              aria-label="思考强度"
              onChange={(event) => {
                const nextReasoning = event.currentTarget.value
                if (isAiChatReasoning(nextReasoning)) onReasoningChange(nextReasoning)
              }}
            >
              {REASONING_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </section>

        <p className="border-t border-border px-2 pt-2 pb-1 text-[9px] leading-4 text-muted-foreground">
          Skill 与设置只声明本轮意图，实际能力仍受模型、工作区和用户授权约束。
        </p>
      </PopoverContent>
    </Popover>
  )
}
