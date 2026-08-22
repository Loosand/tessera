/**
 * [INPUT]: 对话草稿、自动运行边界、创作模式、当前文档/图片附件、模型能力、生成状态与提交/停止回调
 * [OUTPUT]: 可按内容有限增高、只暴露创作模式、附件、模型与发送入口的紧凑任务输入框
 * [POS]: task-page 的可复用底部/空状态输入表面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSkillId } from "@tessera/contracts"
import {
  Add01Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  CancelCircleIcon,
  File02Icon,
  StopIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { Textarea } from "@tessera/design-system/components/ui/textarea"
import React, { type FormEvent, type KeyboardEvent, useRef, useState } from "react"
import type { AvailableAiModel } from "../hooks/use-ai-models"
import { ModelPicker } from "./model-picker"
import { TaskCapabilityPicker } from "./task-capability-picker"

export type ComposerImage = {
  readonly filename: string
  readonly id: string
  readonly mediaType: string
  readonly url: string
}

export type ComposerDocumentContext = {
  readonly filename: string
  readonly relativePath: string
}

type TaskComposerProps = {
  readonly agentMode: boolean
  readonly agentReady: boolean
  readonly availableDocument: ComposerDocumentContext | null
  readonly compact?: boolean
  readonly documentContext: ComposerDocumentContext | null
  readonly images: readonly ComposerImage[]
  readonly model: AvailableAiModel | undefined
  readonly modelLoading: boolean
  readonly models: readonly AvailableAiModel[]
  readonly notice: string
  readonly onAddImages: (files: FileList) => void
  readonly onAddCurrentDocument: () => void
  readonly onChange: (value: string) => void
  readonly onModelChange: (key: string) => void
  readonly onSkillChange: (skillId: TaskSkillId) => void
  readonly onRemoveDocumentContext: () => void
  readonly onRemoveImage: (id: string) => void
  readonly onStop: () => void
  readonly onSubmit: () => void
  readonly scope: string
  readonly selectedModelKey: string
  readonly skillId: TaskSkillId
  readonly status: "error" | "ready" | "streaming" | "submitted"
  readonly value: string
}

export function TaskComposer({
  agentMode,
  agentReady,
  availableDocument,
  compact = false,
  documentContext,
  images,
  model,
  modelLoading,
  models,
  notice,
  onAddImages,
  onAddCurrentDocument,
  onChange,
  onModelChange,
  onSkillChange,
  onRemoveDocumentContext,
  onRemoveImage,
  onStop,
  onSubmit,
  scope,
  selectedModelKey,
  skillId,
  status,
  value,
}: TaskComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const running = status === "submitted" || status === "streaming"
  const canSubmit = Boolean(model && (value.trim() || images.length > 0) && (!agentMode || agentReady))
  const supportsImages = model?.inputModalities?.includes("image") === true
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
    <form className="w-full" onSubmit={submit}>
      <div className="rounded-[24px] border border-border/80 bg-background shadow-[0_8px_28px_-20px_color-mix(in_oklch,var(--foreground)_32%,transparent)]">
        {documentContext || images.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {documentContext ? (
              <div className="group flex h-10 max-w-56 shrink-0 items-center gap-2 rounded-lg bg-muted px-2.5 text-left">
                <Icon icon={File02Icon} size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium">{documentContext.filename}</span>
                  <span className="block truncate text-[9px] text-muted-foreground">当前文档</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 rounded-full"
                  aria-label={`移除文档 ${documentContext.filename}`}
                  onClick={onRemoveDocumentContext}
                >
                  <Icon icon={CancelCircleIcon} size={13} />
                </Button>
              </div>
            ) : null}
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
          <Popover open={attachmentOpen} onOpenChange={setAttachmentOpen}>
            <PopoverTrigger
              render={
                <Button type="button" variant="ghost" size="icon-sm" aria-label="添加附件">
                  <Icon icon={Add01Icon} size={17} />
                </Button>
              }
            />
            <PopoverContent
              side="top"
              align="start"
              sideOffset={6}
              className="w-56 rounded-xl border border-border/70 p-1.5 ring-0"
            >
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-9 w-full justify-start gap-2 rounded-lg px-2 py-1.5 font-normal"
                disabled={!availableDocument || Boolean(documentContext)}
                onClick={() => {
                  onAddCurrentDocument()
                  setAttachmentOpen(false)
                }}
              >
                <Icon icon={File02Icon} size={14} />
                <span className="min-w-0 flex-1 truncate text-left text-xs">
                  {availableDocument ? `当前文档：${availableDocument.filename}` : "当前没有打开文档"}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full justify-start gap-2 rounded-lg px-2 font-normal"
                disabled={!supportsImages || images.length >= 4}
                onClick={() => {
                  fileInputRef.current?.click()
                  setAttachmentOpen(false)
                }}
              >
                <Icon icon={Attachment01Icon} size={14} />
                <span className="text-xs">{supportsImages ? "添加本地图片" : "当前模型不支持图片"}</span>
              </Button>
            </PopoverContent>
          </Popover>

          <TaskCapabilityPicker running={running} skillId={skillId} onSkillChange={onSkillChange} />

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

          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <ModelPicker
              loading={modelLoading}
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
  )
}
