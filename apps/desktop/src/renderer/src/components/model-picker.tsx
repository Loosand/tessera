/**
 * [INPUT]: 当前模型、可用模型目录、选中键与切换回调
 * [OUTPUT]: 按供应商分组、展示模型图标/能力/选中态的模型选择浮层
 * [POS]: task-composer 中替代原生下拉的高信息密度模型入口
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { AiModelIcon } from "@tessera/ai/react"
import { ArrowDown01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { useMemo, useState } from "react"
import type { AvailableAiModel } from "../hooks/use-ai-models"

interface ModelPickerProps {
  model: AvailableAiModel | undefined
  models: readonly AvailableAiModel[]
  onModelChange: (key: string) => void
  selectedModelKey: string
}

export function aiModelKey(model: Pick<AvailableAiModel, "id" | "providerId">) {
  return `${model.providerId}::${model.id}`
}

function modelCapabilityLabel(model: AvailableAiModel) {
  const labels: string[] = []
  if (model.capabilities?.reasoning === "supported") labels.push("思考")
  if (model.capabilities?.search === "supported") labels.push("联网")
  if (model.capabilities?.imageInput === "supported") labels.push("图像")
  return labels.join(" · ")
}

const MODEL_TOKEN_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  claude: "Claude",
  deepseek: "DeepSeek",
  flash: "Flash",
  gemini: "Gemini",
  gpt: "GPT",
  grok: "Grok",
  kimi: "Kimi",
  mini: "Mini",
  openai: "OpenAI",
  opus: "Opus",
  pro: "Pro",
  qwen: "Qwen",
  sonnet: "Sonnet",
  vision: "Vision",
}

function modelDisplayName(model: AvailableAiModel) {
  const name = model.name?.trim()
  if (name && name !== model.id) return name

  return model.id
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((token) => {
      const normalized = token.toLowerCase()
      const knownLabel = MODEL_TOKEN_LABELS[normalized]
      if (knownLabel) return knownLabel
      if (/^v\d/i.test(token)) return token.toUpperCase()
      return token.charAt(0).toUpperCase() + token.slice(1)
    })
    .join(" ")
}

export function ModelPicker({ model, models, onModelChange, selectedModelKey }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, AvailableAiModel[]>()
    for (const candidate of models) {
      const group = groups.get(candidate.providerName) ?? []
      group.push(candidate)
      groups.set(candidate.providerName, group)
    }
    return groups
  }, [models])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-w-0 max-w-48 rounded-full bg-muted/60 px-2 text-xs font-normal hover:bg-muted data-[popup-open]:bg-muted"
            aria-label="选择模型"
            disabled={models.length === 0}
          />
        }
      >
        {model ? <AiModelIcon modelId={model.id} size={16} /> : null}
        <span className="truncate">{model ? modelDisplayName(model) : "未配置模型"}</span>
        <Icon icon={ArrowDown01Icon} size={12} className="text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="flex max-h-[min(24rem,var(--available-height))] w-72 flex-col overflow-hidden rounded-xl border border-border/70 p-1.5 shadow-[0_18px_50px_-28px_color-mix(in_oklch,var(--foreground)_42%,transparent)] ring-0"
      >
        <header className="flex h-8 shrink-0 items-center px-2">
          <h2 className="text-[13px] font-medium">模型</h2>
        </header>

        <nav className="min-h-0 overflow-y-auto" aria-label="可用模型">
          {[...modelsByProvider].map(([providerName, providerModels]) => (
            <section key={providerName} className="not-first:mt-1" aria-label={providerName}>
              {modelsByProvider.size > 1 ? (
                <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground">
                  {providerName}
                </div>
              ) : null}
              <div className="space-y-0.5">
                {providerModels.map((candidate) => {
                  const key = aiModelKey(candidate)
                  const selected = key === selectedModelKey
                  const capabilityLabel = modelCapabilityLabel(candidate)

                  return (
                    <Button
                      key={key}
                      type="button"
                      variant="ghost"
                      className="h-9 w-full justify-start gap-2 rounded-lg px-2 text-left font-normal data-[selected=true]:bg-muted/60"
                      aria-current={selected ? "true" : undefined}
                      data-selected={selected || undefined}
                      title={candidate.id}
                      onClick={() => {
                        onModelChange(key)
                        setOpen(false)
                      }}
                    >
                      <AiModelIcon modelId={candidate.id} size={18} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {modelDisplayName(candidate)}
                      </span>
                      {capabilityLabel ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">{capabilityLabel}</span>
                      ) : null}
                    </Button>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>
      </PopoverContent>
    </Popover>
  )
}
