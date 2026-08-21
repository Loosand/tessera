/**
 * [INPUT]: 对话草稿、附件、模型能力、生成状态与提交/停止回调
 * [OUTPUT]: 同时适合手动长文本编辑和 AI 能力选择的任务输入框
 * [POS]: task-page 的可复用底部/空状态输入表面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatReasoning } from "@tessera/contracts"
import {
  AiWebBrowsingIcon,
  ArrowUp01Icon,
  BrainCircuitIcon,
  CancelCircleIcon,
  ImageUpload01Icon,
  StopIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@tessera/design-system/components/ui/select"
import { Textarea } from "@tessera/design-system/components/ui/textarea"
import { type FormEvent, type KeyboardEvent, useMemo, useRef } from "react"
import type { AvailableAiModel } from "../hooks/use-ai-models"

export interface ComposerImage {
  filename: string
  id: string
  mediaType: string
  url: string
}

interface TaskComposerProps {
  compact?: boolean
  images: readonly ComposerImage[]
  model: AvailableAiModel | undefined
  models: readonly AvailableAiModel[]
  notice: string
  onAddImages: (files: FileList) => void
  onChange: (value: string) => void
  onModelChange: (key: string) => void
  onReasoningChange: (reasoning: AiChatReasoning) => void
  onRemoveImage: (id: string) => void
  onStop: () => void
  onSubmit: () => void
  onWebSearchChange: (enabled: boolean) => void
  reasoning: AiChatReasoning
  selectedModelKey: string
  status: "error" | "ready" | "streaming" | "submitted"
  value: string
  webSearch: boolean
}

export function aiModelKey(model: Pick<AvailableAiModel, "id" | "providerId">) {
  return `${model.providerId}::${model.id}`
}

const REASONING_LABELS: Record<AiChatReasoning, string> = {
  auto: "自动思考",
  none: "不思考",
  low: "简短思考",
  medium: "深入思考",
  high: "充分思考",
}

export function TaskComposer({
  compact = false,
  images,
  model,
  models,
  notice,
  onAddImages,
  onChange,
  onModelChange,
  onReasoningChange,
  onRemoveImage,
  onStop,
  onSubmit,
  onWebSearchChange,
  reasoning,
  selectedModelKey,
  status,
  value,
  webSearch,
}: TaskComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const running = status === "submitted" || status === "streaming"
  const canSubmit = Boolean(model && (value.trim() || images.length > 0))
  const supportsSearch = model?.capabilities?.search === "supported"
  const supportsReasoning = model?.capabilities?.reasoning === "supported"
  const supportsImages = model?.capabilities?.imageInput === "supported"
  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, AvailableAiModel[]>()
    for (const candidate of models) {
      const group = groups.get(candidate.providerName) ?? []
      group.push(candidate)
      groups.set(candidate.providerName, group)
    }
    return groups
  }, [models])

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
      <div className="rounded-2xl border border-input bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-md">
        {images.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {images.map((image) => (
              <div key={image.id} className="group relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
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
          className={`${compact ? "min-h-20" : "min-h-32"} resize-none border-0 bg-transparent px-4 py-3.5 text-[15px] leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent`}
          placeholder="描述你想研究、阅读或写作的内容…"
          aria-label="任务内容"
          aria-describedby="task-composer-notice"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="flex min-h-12 flex-wrap items-center gap-1.5 px-3 pb-3">
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
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!supportsImages || images.length >= 4}
            aria-label="上传图片"
            title={supportsImages ? "上传图片" : "当前模型未声明图片输入能力"}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon icon={ImageUpload01Icon} size={16} />
          </Button>
          <Button
            type="button"
            variant={webSearch ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs font-normal"
            disabled={!supportsSearch}
            aria-pressed={webSearch}
            title={supportsSearch ? "允许模型联网搜索" : "当前模型没有已验证的联网搜索能力"}
            onClick={() => onWebSearchChange(!webSearch)}
          >
            <Icon icon={AiWebBrowsingIcon} size={14} />
            <span className="max-[540px]:hidden">联网</span>
          </Button>

          <Select
            value={reasoning}
            disabled={!supportsReasoning}
            onValueChange={(nextReasoning) => {
              if (nextReasoning) onReasoningChange(nextReasoning as AiChatReasoning)
            }}
          >
            <SelectTrigger
              size="sm"
              className="border-transparent px-2 text-xs font-normal shadow-none"
              aria-label="思考模式"
              title={supportsReasoning ? "选择思考强度" : "当前模型没有已验证的可控思考能力"}
            >
              <Icon icon={BrainCircuitIcon} size={14} />
              <SelectValue>{(value: AiChatReasoning) => REASONING_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start" className="min-w-40">
              {(Object.keys(REASONING_LABELS) as AiChatReasoning[]).map((level) => (
                <SelectItem key={level} value={level}>
                  {REASONING_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Select value={selectedModelKey} onValueChange={(key) => key && onModelChange(key)}>
              <SelectTrigger
                size="sm"
                className="max-w-52 border-transparent px-2 text-xs font-normal shadow-none"
                aria-label="选择模型"
                disabled={models.length === 0}
              >
                <SelectValue>
                  {() => (model ? model.name || model.id : models.length === 0 ? "未配置模型" : "选择模型")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="min-w-64">
                {[...modelsByProvider].map(([providerName, providerModels]) => (
                  <SelectGroup key={providerName}>
                    <SelectLabel>{providerName}</SelectLabel>
                    {providerModels.map((candidate) => (
                      <SelectItem key={aiModelKey(candidate)} value={aiModelKey(candidate)}>
                        <span className="max-w-56 truncate">{candidate.name || candidate.id}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            <Button
              type={running ? "button" : "submit"}
              size="icon-lg"
              className="rounded-full"
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
      <p
        id="task-composer-notice"
        className={`${compact ? "mt-2" : "mt-3"} min-h-5 text-center text-xs text-muted-foreground`}
        aria-live="polite"
      >
        {notice || "Enter 发送，Shift + Enter 换行"}
      </p>
    </form>
  )
}
