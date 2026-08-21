/**
 * [INPUT]: 对话草稿、执行模式、内置 Skill、只读范围、附件、模型能力、生成状态与提交/停止回调
 * [OUTPUT]: 可按内容有限增高、以原生单选切换执行模式和问答/研究/写作、图标能力入口、模型/范围状态和行内反馈组织的紧凑任务输入框
 * [POS]: task-page 的可复用底部/空状态输入表面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatReasoning, TaskMode, TaskSkillId } from "@tessera/contracts"
import {
  Add01Icon,
  AiWebBrowsingIcon,
  ArrowUp01Icon,
  BrainCircuitIcon,
  CancelCircleIcon,
  StopIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Textarea } from "@tessera/design-system/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@tessera/design-system/components/ui/tooltip"
import { listBuiltInSkills } from "@tessera/skills"
import { type FormEvent, type KeyboardEvent, useRef } from "react"
import type { AvailableAiModel } from "../hooks/use-ai-models"
import { ModelPicker } from "./model-picker"

export type ComposerImage = {
  readonly filename: string
  readonly id: string
  readonly mediaType: string
  readonly url: string
}

type TaskComposerProps = {
  readonly agentReady: boolean
  readonly compact?: boolean
  readonly images: readonly ComposerImage[]
  readonly model: AvailableAiModel | undefined
  readonly models: readonly AvailableAiModel[]
  readonly notice: string
  readonly onAddImages: (files: FileList) => void
  readonly onChange: (value: string) => void
  readonly onModelChange: (key: string) => void
  readonly onModeChange: (mode: TaskMode) => void
  readonly onSkillChange: (skillId: TaskSkillId) => void
  readonly onReasoningChange: (reasoning: AiChatReasoning) => void
  readonly onRemoveImage: (id: string) => void
  readonly onStop: () => void
  readonly onSubmit: () => void
  readonly onWebSearchChange: (enabled: boolean) => void
  readonly reasoning: AiChatReasoning
  readonly scope: string
  readonly mode: TaskMode
  readonly modeLocked: boolean
  readonly selectedModelKey: string
  readonly skillId: TaskSkillId
  readonly skillLocked: boolean
  readonly status: "error" | "ready" | "streaming" | "submitted"
  readonly value: string
  readonly webSearch: boolean
}

const REASONING_OPTIONS = [
  { id: "auto", label: "自动思考" },
  { id: "none", label: "不思考" },
  { id: "low", label: "简短思考" },
  { id: "medium", label: "深入思考" },
  { id: "high", label: "充分思考" },
] as const satisfies readonly { readonly id: AiChatReasoning; readonly label: string }[]

function isAiChatReasoning(value: unknown): value is AiChatReasoning {
  return typeof value === "string" && REASONING_OPTIONS.some((option) => option.id === value)
}

function reasoningLabel(reasoning: AiChatReasoning) {
  return REASONING_OPTIONS.find((option) => option.id === reasoning)?.label ?? reasoning
}

const TASK_SKILL_OPTIONS = [
  { id: null, displayName: "问答", shortDescription: "不加载内置 Skill" },
  ...listBuiltInSkills().map((skill) => ({
    id: skill.name,
    displayName: skill.displayName,
    shortDescription: `${skill.shortDescription}；实际能力仍受当前工具授权约束`,
  })),
] satisfies readonly {
  id: TaskSkillId
  displayName: string
  shortDescription: string
}[]

export function TaskComposer({
  agentReady,
  compact = false,
  images,
  model,
  models,
  notice,
  onAddImages,
  onChange,
  onModelChange,
  onModeChange,
  onSkillChange,
  onReasoningChange,
  onRemoveImage,
  onStop,
  onSubmit,
  onWebSearchChange,
  reasoning,
  scope,
  mode,
  modeLocked,
  selectedModelKey,
  skillId,
  skillLocked,
  status,
  value,
  webSearch,
}: TaskComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const running = status === "submitted" || status === "streaming"
  const canSubmit = Boolean(
    model &&
      (value.trim() || images.length > 0) &&
      (mode === "chat" || (agentReady && model.capabilities?.toolUse === "supported")),
  )
  const supportsSearch = mode === "chat" && model?.capabilities?.search === "supported"
  const supportsReasoning = model?.capabilities?.reasoning === "supported"
  const supportsImages = model?.capabilities?.imageInput === "supported"
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (running || !canSubmit) return
    onSubmit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!running && canSubmit) event.currentTarget.form?.requestSubmit()
  }

  return (
    <TooltipProvider delay={350} closeDelay={50}>
      <form className="w-full" onSubmit={submit}>
        <div className="rounded-[24px] border border-border/80 bg-background shadow-[0_8px_28px_-20px_color-mix(in_oklch,var(--foreground)_32%,transparent)]">
          {images.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto px-3 pt-3">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted"
                >
                  <img className="size-full object-cover" src={image.url} alt={image.filename} />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-xs"
                    className="absolute top-1 right-1 rounded-full opacity-90"
                    aria-label={`移除图片 ${image.filename}`}
                    onClick={() => onRemoveImage(image.id)}
                  >
                    <Icon icon={CancelCircleIcon} size={13} />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <Textarea
            value={value}
            autoFocus={!compact}
            className={`${compact ? "min-h-12 max-h-32" : "min-h-16 max-h-40"} field-sizing-content resize-none overflow-y-auto border-0 bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent`}
            placeholder="随心输入…"
            aria-label="任务内容"
            aria-describedby={notice ? "task-composer-notice" : undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />

          <div className="flex min-h-11 items-center gap-1 px-3 pb-2.5">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={(event) => {
                if (event.currentTarget.files) onAddImages(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!supportsImages || images.length >= 4}
                    aria-label="添加图片"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon icon={Add01Icon} size={17} />
                  </Button>
                }
              />
              <TooltipContent>{supportsImages ? "添加图片" : "当前模型不支持图片输入"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={webSearch ? "secondary" : "ghost"}
                    size="icon-sm"
                    disabled={!supportsSearch}
                    aria-label={webSearch ? "关闭联网搜索" : "开启联网搜索"}
                    aria-pressed={webSearch}
                    onClick={() => onWebSearchChange(!webSearch)}
                  >
                    <Icon icon={AiWebBrowsingIcon} size={15} />
                  </Button>
                }
              />
              <TooltipContent>
                {supportsSearch ? (webSearch ? "关闭联网搜索" : "开启联网搜索") : "当前模型不支持联网搜索"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={`relative inline-flex size-7 items-center justify-center rounded-[min(var(--radius-md),12px)] text-muted-foreground transition-colors ${supportsReasoning ? "hover:bg-muted hover:text-foreground" : "cursor-not-allowed opacity-50"}`}
                  >
                    <Icon icon={BrainCircuitIcon} size={15} />
                    <NativeSelect
                      size="sm"
                      containerClassName="absolute inset-0 size-full opacity-0 [&_[data-slot=native-select-icon]]:hidden"
                      className="size-full cursor-pointer"
                      value={reasoning}
                      disabled={!supportsReasoning}
                      aria-label="思考模式"
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
                  </span>
                }
              />
              <TooltipContent>
                {supportsReasoning
                  ? `思考模式：${reasoningLabel(reasoning)}`
                  : "当前模型不支持思考强度控制"}
              </TooltipContent>
            </Tooltip>

            <div className="min-w-0 flex-1 px-1.5">
              {notice ? (
                <p
                  id="task-composer-notice"
                  className="truncate text-xs text-destructive"
                  title={notice}
                  aria-live="polite"
                >
                  {notice}
                </p>
              ) : scope ? (
                <p className="truncate text-[11px] text-muted-foreground" title={scope}>
                  {scope}
                </p>
              ) : null}
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-1.5">
              <fieldset
                className="flex shrink-0 rounded-md bg-muted/70 p-0.5"
                aria-label="对话 Skill"
                disabled={skillLocked || running}
              >
                {TASK_SKILL_OPTIONS.map((option) => (
                  <label
                    key={option.id ?? "question-answering"}
                    title={option.shortDescription}
                    className="relative cursor-pointer rounded-[5px] px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-xs has-[:disabled]:cursor-default has-[:disabled]:opacity-70 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  >
                    <input
                      type="radio"
                      name={`task-skill-${compact ? "compact" : "empty"}`}
                      value={option.id ?? "question-answering"}
                      checked={skillId === option.id}
                      className="sr-only"
                      onChange={() => onSkillChange(option.id)}
                    />
                    {option.displayName}
                  </label>
                ))}
              </fieldset>

              <fieldset
                className="flex shrink-0 rounded-md bg-muted/70 p-0.5"
                aria-label="任务模式"
                disabled={modeLocked || running}
              >
                {(["chat", "agent"] as const).map((option) => (
                  <label
                    key={option}
                    className="relative cursor-pointer rounded-[5px] px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-xs has-[:disabled]:cursor-default has-[:disabled]:opacity-70 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  >
                    <input
                      type="radio"
                      name={`task-mode-${compact ? "compact" : "empty"}`}
                      value={option}
                      checked={mode === option}
                      className="sr-only"
                      onChange={() => onModeChange(option)}
                    />
                    {option === "chat" ? "Chat" : "Agent"}
                  </label>
                ))}
              </fieldset>

              <ModelPicker
                model={model}
                models={models}
                selectedModelKey={selectedModelKey}
                onModelChange={onModelChange}
              />

              <Button
                type={running ? "button" : "submit"}
                size="icon-lg"
                className="size-8 rounded-full"
                aria-label={running ? "停止生成" : "发送消息"}
                title={running ? "停止生成" : "发送消息"}
                disabled={!running && !canSubmit}
                onClick={running ? onStop : undefined}
              >
                <Icon icon={running ? StopIcon : ArrowUp01Icon} size={running ? 14 : 17} />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </TooltipProvider>
  )
}
