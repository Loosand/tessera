/**
 * [INPUT]: 当前模型、可用模型目录、选中键与切换回调
 * [OUTPUT]: 以小字号胶囊入口和统一圆角层级呈现供应商分组、模型图标、有效能力与选中态的模型选择浮层
 * [POS]: task-composer 中替代原生下拉的高信息密度模型入口
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { resolveAiModelExecution } from "@tessera/ai"
import { AiModelIcon } from "@tessera/ai/react"
import { ArrowDown01Icon, Tick02Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import React, { useMemo, useState } from "react"
import type { AvailableAiModel } from "../hooks/use-ai-models"

type ModelPickerProps = Readonly<{
  loading: boolean
  model: AvailableAiModel | undefined
  models: readonly AvailableAiModel[]
  onModelChange: (key: string) => void
  selectedModelKey: string
}>

export function aiModelKey(model: Pick<AvailableAiModel, "configId" | "id">) {
  return `${model.configId}::${model.id}`
}

function modelCapabilityLabel(model: AvailableAiModel) {
  const labels: string[] = []
  if (model.modelType && model.modelType !== "chat") labels.push(model.modelType)
  if (model.capabilities?.reasoning === "supported") labels.push("思考")
  if (
    resolveAiModelExecution({
      baseUrl: model.baseUrl,
      mode: "chat",
      model,
      providerId: model.providerId,
      webSearch: true,
    }).searchRoute === "provider-native"
  ) {
    labels.push("联网")
  }
  if (model.inputModalities?.includes("image")) labels.push("图像")
  if (model.capabilities?.functionCall === "supported") labels.push("工具")
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

export function ModelPicker({ loading, model, models, onModelChange, selectedModelKey }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, AvailableAiModel[]>()
    for (const candidate of models) {
      const groupName = candidate.displayName || candidate.providerName
      const group = groups.get(groupName) ?? []
      group.push(candidate)
      groups.set(groupName, group)
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
            className="h-7 min-w-0 max-w-52 gap-1.5 rounded-full bg-transparent px-2 text-[9.5px] font-normal text-foreground/80 hover:bg-background/70 data-[popup-open]:bg-background/70"
            data-control="model-picker-trigger"
            aria-label="选择模型"
            disabled={models.length === 0}
          />
        }
      >
        {model ? <AiModelIcon modelId={model.id} size={12} /> : null}
        <span className="truncate text-[9.5px] leading-none">
          {model ? modelDisplayName(model) : loading ? "正在加载模型" : "未配置模型"}
        </span>
        <Icon icon={ArrowDown01Icon} size={9} className="text-muted-foreground/80" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="flex max-h-[min(24rem,var(--available-height))] w-72 flex-col overflow-hidden rounded-2xl border border-border/70 p-1.5 shadow-[0_18px_50px_-28px_color-mix(in_oklch,var(--foreground)_42%,transparent)] ring-0"
      >
        <header className="flex h-8 shrink-0 items-center justify-between px-2.5">
          <h2 className="text-[11px] font-medium">模型</h2>
          <span className="text-[9px] text-muted-foreground">{models.length} 个可用</span>
        </header>

        <nav className="min-h-0 overflow-y-auto" aria-label="可用模型">
          {[...modelsByProvider].map(([providerName, providerModels]) => (
            <section key={providerName} className="not-first:mt-1" aria-label={providerName}>
              {modelsByProvider.size > 1 ? (
                <div className="px-2.5 pt-2 pb-1 text-[9px] font-medium text-muted-foreground">
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
                      className="h-auto min-h-10 w-full justify-start gap-2 rounded-xl px-2.5 py-1.5 text-left font-normal data-[selected=true]:bg-muted/75"
                      aria-current={selected ? "true" : undefined}
                      data-selected={selected || undefined}
                      title={candidate.id}
                      onClick={() => {
                        onModelChange(key)
                        setOpen(false)
                      }}
                    >
                      <AiModelIcon modelId={candidate.id} size={16} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] leading-4">
                          {modelDisplayName(candidate)}
                        </span>
                        {capabilityLabel ? (
                          <span className="block truncate text-[9px] leading-3.5 text-muted-foreground">
                            {capabilityLabel}
                          </span>
                        ) : null}
                      </span>
                      {selected ? (
                        <Icon icon={Tick02Icon} size={12} className="shrink-0 text-foreground/70" />
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
