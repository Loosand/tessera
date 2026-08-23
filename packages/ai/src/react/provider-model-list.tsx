/**
 * [INPUT]: 供应商模型草稿、模型编辑/启停/删除回调与模型能力事实
 * [OUTPUT]: 带能力提示、模型元数据和行级操作的分组模型列表
 * [POS]: @tessera/ai/react 供应商详情页的模型目录展示组件
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  AiWebBrowsingIcon,
  BrainCircuitIcon,
  Delete02Icon,
  ImageUpload01Icon,
  Message01Icon,
  Settings01Icon,
  SourceCodeIcon,
  Wrench01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon, type IconProps } from "@tessera/design-system/components/ui/icon"
import { Switch } from "@tessera/design-system/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@tessera/design-system/components/ui/tooltip"
import type { AiProviderModelDraft } from "../provider-catalog"
import { AiModelIcon } from "./ai-model-icon"

function formatTokenLimit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

type ModelCapabilityBadgeProps = {
  icon: IconProps["icon"]
  label: string
  tone: "context" | "reasoning" | "structured" | "tool" | "vision" | "web"
  value?: string
}

const MODEL_CAPABILITY_BADGE_TONES: Record<ModelCapabilityBadgeProps["tone"], string> = {
  context: "bg-capability-context/10 text-capability-context",
  reasoning: "bg-capability-reasoning/10 text-capability-reasoning",
  structured: "bg-capability-structured/10 text-capability-structured",
  tool: "bg-capability-tool/10 text-capability-tool",
  vision: "bg-capability-vision/10 text-capability-vision",
  web: "bg-capability-web/10 text-capability-web",
}

function ModelCapabilityBadge({ icon, label, tone, value }: ModelCapabilityBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={`flex h-6 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 ${MODEL_CAPABILITY_BADGE_TONES[tone]}`}
        aria-label={label}
      >
        <Icon icon={icon} size={13} strokeWidth={1.9} />
        {value ? <span className="text-[9px] font-medium tabular-nums">{value}</span> : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ModelCapabilityBadges({ model }: { model: AiProviderModelDraft }) {
  const nativeWebSearch = model.endpointBindings?.some((binding) => binding.nativeWebSearch === "supported")
  const acceptsImages = model.inputModalities?.includes("image")

  return (
    <TooltipProvider delay={250}>
      <fieldset className="flex shrink-0 items-center gap-1">
        <legend className="sr-only">模型能力</legend>
        {model.contextWindow ? (
          <ModelCapabilityBadge
            icon={Message01Icon}
            tone="context"
            value={formatTokenLimit(model.contextWindow)}
            label={`上下文窗口 ${formatTokenLimit(model.contextWindow)} Tokens`}
          />
        ) : null}
        {acceptsImages ? (
          <ModelCapabilityBadge icon={ImageUpload01Icon} tone="vision" label="支持图片输入" />
        ) : null}
        {model.capabilities?.reasoning === "supported" ? (
          <ModelCapabilityBadge icon={BrainCircuitIcon} tone="reasoning" label="支持推理" />
        ) : null}
        {model.capabilities?.functionCall === "supported" ? (
          <ModelCapabilityBadge icon={Wrench01Icon} tone="tool" label="支持工具调用与 Agent" />
        ) : null}
        {model.capabilities?.structuredOutput === "supported" ? (
          <ModelCapabilityBadge icon={SourceCodeIcon} tone="structured" label="支持结构化输出" />
        ) : null}
        {nativeWebSearch ? (
          <ModelCapabilityBadge icon={AiWebBrowsingIcon} tone="web" label="当前端点支持原生联网搜索" />
        ) : null}
      </fieldset>
    </TooltipProvider>
  )
}

type ProviderModelGroupProps = {
  disabled: boolean
  label: string
  models: readonly AiProviderModelDraft[]
  onDelete: (modelId: string) => void
  onEdit: (modelId: string) => void
  onToggle: (modelId: string, enabled: boolean) => void
}

export function ProviderModelGroup({
  disabled,
  label,
  models,
  onDelete,
  onEdit,
  onToggle,
}: ProviderModelGroupProps) {
  if (models.length === 0) return null

  return (
    <section aria-label={`${label}模型`}>
      <header className="flex items-center justify-between border-b border-border bg-muted/25 px-4 py-2">
        <h4 className="text-[11px] font-medium text-muted-foreground">{label}</h4>
        <span className="text-[10px] tabular-nums text-muted-foreground">{models.length}</span>
      </header>
      <div>
        {models.map((model) => (
          <div
            key={model.id}
            className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2.5 [contain-intrinsic-size:auto_60px] [content-visibility:auto] last:border-b-0"
          >
            <AiModelIcon modelId={model.id} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="truncate text-[13px] font-medium text-foreground">{model.name || model.id}</p>
                {model.name && model.name !== model.id ? (
                  <code className="truncate font-mono text-[10px] text-muted-foreground">{model.id}</code>
                ) : null}
              </div>
              {model.ownedBy || model.modelType || model.maxOutputTokens ? (
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  {model.ownedBy ? <span>{model.ownedBy}</span> : null}
                  {model.modelType ? <span>{model.modelType}</span> : null}
                  {model.maxOutputTokens ? (
                    <span>最大输出 {formatTokenLimit(model.maxOutputTokens)}</span>
                  ) : null}
                </p>
              ) : null}
            </div>
            <ModelCapabilityBadges model={model} />
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`编辑模型 ${model.id}`}
              onClick={() => onEdit(model.id)}
            >
              <Icon icon={Settings01Icon} size={14} />
            </Button>
            <Switch
              checked={model.enabled}
              disabled={disabled}
              size="sm"
              onCheckedChange={(enabled) => onToggle(model.id, enabled)}
              aria-label={`${model.enabled ? "停用" : "启用"}模型 ${model.id}`}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`删除模型 ${model.id}`}
              onClick={() => onDelete(model.id)}
            >
              <Icon icon={Delete02Icon} size={14} />
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
