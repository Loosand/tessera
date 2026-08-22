/**
 * [INPUT]: 已归一化供应商模型草稿、打开状态与保存回调
 * [OUTPUT]: LobeHub 式纵向模型编辑器，配置模型事实并只读展示端点投递能力
 * [POS]: AI 供应商设置中统一模型事实的编辑边界
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  AI_MODEL_MODALITIES,
  AI_MODEL_TYPES,
  type AiModelCapabilities,
  type AiModelCapabilityKey,
  type AiModelCapabilitySource,
  type AiModelCapabilityState,
  type AiModelModality,
  type AiModelType,
} from "@tessera/contracts"
import {
  AiWebBrowsingIcon,
  BrainCircuitIcon,
  Cancel01Icon,
  ImageUpload01Icon,
  Message01Icon,
  SourceCodeIcon,
  Wrench01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@tessera/design-system/components/ui/dialog"
import { Icon, type IconProps } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Slider } from "@tessera/design-system/components/ui/slider"
import { type ReactNode, useState } from "react"
import type { AiProviderModelDraft, AiProviderModelProfileUpdate } from "../provider-catalog"

const MODEL_TYPE_LABELS: Record<AiModelType, string> = {
  chat: "对话",
  embedding: "向量化",
  rerank: "重排",
  "image-generation": "图片生成",
  "video-generation": "视频生成",
  "text-to-speech": "文字转语音",
  "speech-to-text": "语音识别",
  realtime: "实时交互",
}

const MODALITY_LABELS: Record<AiModelModality, string> = {
  text: "文本",
  image: "图片",
  audio: "音频",
  video: "视频",
  vector: "向量",
}

const CAPABILITY_LABELS: Record<AiModelCapabilityKey, string> = {
  functionCall: "支持工具使用",
  reasoning: "支持深度思考",
  structuredOutput: "支持结构化输出",
}

const CAPABILITY_DESCRIPTIONS: Record<AiModelCapabilityKey, string> = {
  functionCall: "允许模型调用 Tessera 与 Agent 工具；真实可用性还取决于当前供应商端点。",
  reasoning: "开放推理强度与思考内容相关能力；具体效果仍由模型和供应商实现决定。",
  structuredOutput: "允许模型按 JSON Schema 等约束返回可解析的结构化结果。",
}

const CAPABILITY_ICONS: Record<AiModelCapabilityKey, IconProps["icon"]> = {
  functionCall: Wrench01Icon,
  reasoning: BrainCircuitIcon,
  structuredOutput: SourceCodeIcon,
}

const CAPABILITY_ICON_TONES: Record<AiModelCapabilityKey, string> = {
  functionCall: "bg-capability-tool/10 text-capability-tool",
  reasoning: "bg-capability-reasoning/10 text-capability-reasoning",
  structuredOutput: "bg-capability-structured/10 text-capability-structured",
}

const CAPABILITY_STATE_LABELS: Record<AiModelCapabilityState, string> = {
  supported: "支持",
  unsupported: "不支持",
  unknown: "未知",
}

const SOURCE_LABELS: Record<AiModelCapabilitySource, string> = {
  builtin: "模型目录",
  remote: "供应商",
  custom: "用户覆盖",
  unknown: "未知",
}

const CONTEXT_WINDOW_STEPS = [
  4_096, 8_192, 16_384, 32_768, 65_536, 128_000, 200_000, 512_000, 1_048_576, 2_097_152,
] as const

type ModelEditorDraft = {
  capabilities: AiModelCapabilities
  contextWindow: string
  inputModalities: AiModelModality[]
  maxInputTokens: string
  maxOutputTokens: string
  modelType: AiModelType
  name: string
  outputModalities: AiModelModality[]
}

function createDraft(model: AiProviderModelDraft): ModelEditorDraft {
  return {
    capabilities: model.capabilities ?? {
      functionCall: "unknown",
      reasoning: "unknown",
      structuredOutput: "unknown",
    },
    contextWindow: model.contextWindow ? String(model.contextWindow) : "",
    inputModalities: model.inputModalities ?? ["text"],
    maxInputTokens: model.maxInputTokens ? String(model.maxInputTokens) : "",
    maxOutputTokens: model.maxOutputTokens ? String(model.maxOutputTokens) : "",
    modelType: model.modelType ?? "chat",
    name: model.name ?? "",
    outputModalities: model.outputModalities ?? ["text"],
  }
}

function positiveInteger(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function toggleModality(modalities: AiModelModality[], modality: AiModelModality) {
  return modalities.includes(modality)
    ? modalities.filter((candidate) => candidate !== modality)
    : [...modalities, modality]
}

function nearestContextStepIndex(value: number | null) {
  if (!value) return 5

  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const [index, step] of CONTEXT_WINDOW_STEPS.entries()) {
    const distance = Math.abs(Math.log(value) - Math.log(step))
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  return nearestIndex
}

function SourceBadge({ source }: { source: AiModelCapabilitySource | undefined }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">
      {SOURCE_LABELS[source ?? "unknown"]}
    </span>
  )
}

function EditorRow({ children, label }: { children: ReactNode; label: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[118px_minmax(0,1fr)] sm:gap-5">
      <div className="pt-1.5 text-[12px] font-medium text-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ModalityPicker({
  label,
  modalities,
  onChange,
}: {
  label: string
  modalities: AiModelModality[]
  onChange: (modalities: AiModelModality[]) => void
}) {
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {AI_MODEL_MODALITIES.map((modality) => (
          <label
            key={modality}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${modalities.includes(modality) ? "border-foreground/25 bg-muted text-foreground" : "border-border text-muted-foreground hover:bg-muted/60"}`}
          >
            <input
              type="checkbox"
              className="size-3 accent-foreground"
              checked={modalities.includes(modality)}
              onChange={() => onChange(toggleModality(modalities, modality))}
            />
            {MODALITY_LABELS[modality]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function CapabilityField({
  capability,
  source,
  state,
  onChange,
}: {
  capability: AiModelCapabilityKey
  source: AiModelCapabilitySource | undefined
  state: AiModelCapabilityState
  onChange: (state: AiModelCapabilityState) => void
}) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_88px] items-start gap-3 py-3.5">
      <span
        className={`flex size-7 items-center justify-center rounded-lg ${CAPABILITY_ICON_TONES[capability]}`}
        aria-hidden="true"
      >
        <Icon icon={CAPABILITY_ICONS[capability]} size={15} strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-foreground">{CAPABILITY_LABELS[capability]}</span>
          <SourceBadge source={source} />
        </div>
        <p className="mt-1 text-[11px] leading-4.5 text-muted-foreground">
          {CAPABILITY_DESCRIPTIONS[capability]}
        </p>
      </div>
      <NativeSelect
        size="sm"
        value={state}
        className="w-full text-xs"
        aria-label={`${CAPABILITY_LABELS[capability]}状态`}
        onChange={(event) => onChange(event.currentTarget.value as AiModelCapabilityState)}
      >
        {(Object.keys(CAPABILITY_STATE_LABELS) as AiModelCapabilityState[]).map((candidate) => (
          <option key={candidate} value={candidate}>
            {CAPABILITY_STATE_LABELS[candidate]}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

function ModelEditorForm({
  model,
  onOpenChange,
  onSave,
}: {
  model: AiProviderModelDraft
  onOpenChange: (open: boolean) => void
  onSave: (update: AiProviderModelProfileUpdate) => void
}) {
  const [draft, setDraft] = useState(() => createDraft(model))
  const contextWindow = positiveInteger(draft.contextWindow)
  const contextStepIndex = nearestContextStepIndex(contextWindow)
  const valid = draft.inputModalities.length > 0 && draft.outputModalities.length > 0

  return (
    <>
      <header className="relative border-b border-border px-6 py-5 pr-14">
        <DialogTitle>编辑模型</DialogTitle>
        <DialogDescription>
          维护模型本身的类型、模态与能力；联网搜索继续按供应商端点单独计算。
        </DialogDescription>
        <DialogClose
          className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="关闭模型编辑器"
        >
          <Icon icon={Cancel01Icon} size={16} />
        </DialogClose>
      </header>

      <div className="max-h-[68vh] overflow-y-auto px-6 py-5">
        <section className="space-y-4" aria-label="基本信息">
          <EditorRow label="模型 ID">
            <Input value={model.id} disabled className="h-8 font-mono text-xs" aria-label="模型 ID" />
            <p className="mt-1 text-[10px] text-muted-foreground">创建后不可修改，调用时作为模型 ID 使用。</p>
          </EditorRow>

          <EditorRow
            label={
              <span className="flex flex-wrap items-center gap-1.5">
                显示名称 <SourceBadge source={model.fieldSources?.name} />
              </span>
            }
          >
            <Input
              value={draft.name}
              className="h-8 text-xs"
              aria-label="模型显示名称"
              placeholder={model.id}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            />
          </EditorRow>

          <EditorRow
            label={
              <span className="flex flex-wrap items-center gap-1.5">
                模型类型 <SourceBadge source={model.fieldSources?.modelType} />
              </span>
            }
          >
            <NativeSelect
              value={draft.modelType}
              containerClassName="w-full"
              className="w-full"
              aria-label="模型类型"
              onChange={(event) =>
                setDraft({ ...draft, modelType: event.currentTarget.value as AiModelType })
              }
            >
              {AI_MODEL_TYPES.map((modelType) => (
                <option key={modelType} value={modelType}>
                  {MODEL_TYPE_LABELS[modelType]}
                </option>
              ))}
            </NativeSelect>
          </EditorRow>

          <EditorRow
            label={
              <span className="flex flex-wrap items-center gap-1.5">
                <Icon icon={Message01Icon} size={14} className="text-capability-context" />
                上下文窗口 <SourceBadge source={model.fieldSources?.contextWindow} />
              </span>
            }
          >
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <Slider
                  aria-label="上下文窗口"
                  value={[contextStepIndex]}
                  min={0}
                  max={CONTEXT_WINDOW_STEPS.length - 1}
                  step={1}
                  onValueChange={(values) => {
                    const nextIndex = Array.isArray(values) ? values[0] : values
                    if (typeof nextIndex === "number") {
                      setDraft({ ...draft, contextWindow: String(CONTEXT_WINDOW_STEPS[nextIndex]) })
                    }
                  }}
                />
                <div className="flex justify-between text-[9px] tabular-nums text-muted-foreground/80">
                  <span>4K</span>
                  <span>32K</span>
                  <span>128K</span>
                  <span>512K</span>
                  <span>1M</span>
                  <span>2M</span>
                </div>
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={draft.contextWindow}
                className="h-8 w-28 shrink-0 text-xs tabular-nums"
                aria-label="上下文窗口 Token 数"
                placeholder="未知"
                onChange={(event) => setDraft({ ...draft, contextWindow: event.currentTarget.value })}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              设置模型单次请求可处理的最大 Token 数。
            </p>
          </EditorRow>
        </section>

        <section className="mt-6 border-t border-border pt-2" aria-labelledby="model-capabilities-title">
          <h3 id="model-capabilities-title" className="pt-3 text-[12px] font-semibold text-foreground">
            模型能力
          </h3>
          <div className="divide-y divide-border">
            {(Object.keys(CAPABILITY_LABELS) as AiModelCapabilityKey[]).map((capability) => (
              <CapabilityField
                key={capability}
                capability={capability}
                source={model.capabilitySources?.[capability]}
                state={draft.capabilities[capability]}
                onChange={(state) =>
                  setDraft({
                    ...draft,
                    capabilities: { ...draft.capabilities, [capability]: state },
                  })
                }
              />
            ))}
          </div>
        </section>

        <section className="space-y-4 border-t border-border py-5" aria-label="输入输出模态">
          <EditorRow
            label={
              <span className="flex items-center gap-1.5">
                <Icon icon={ImageUpload01Icon} size={14} className="text-capability-vision" />
                输入模态
              </span>
            }
          >
            <ModalityPicker
              label="输入模态"
              modalities={draft.inputModalities}
              onChange={(inputModalities) => setDraft({ ...draft, inputModalities })}
            />
          </EditorRow>
          <EditorRow label="输出模态">
            <ModalityPicker
              label="输出模态"
              modalities={draft.outputModalities}
              onChange={(outputModalities) => setDraft({ ...draft, outputModalities })}
            />
          </EditorRow>
        </section>

        <section className="space-y-4 border-t border-border py-5" aria-label="Token 限额">
          <EditorRow
            label={
              <span className="flex flex-wrap items-center gap-1.5">
                最大输入 <SourceBadge source={model.fieldSources?.maxInputTokens} />
              </span>
            }
          >
            <Input
              type="number"
              min={1}
              step={1}
              value={draft.maxInputTokens}
              className="h-8 text-xs tabular-nums"
              aria-label="最大输入 Token"
              placeholder="未知"
              onChange={(event) => setDraft({ ...draft, maxInputTokens: event.currentTarget.value })}
            />
          </EditorRow>
          <EditorRow
            label={
              <span className="flex flex-wrap items-center gap-1.5">
                最大输出 <SourceBadge source={model.fieldSources?.maxOutputTokens} />
              </span>
            }
          >
            <Input
              type="number"
              min={1}
              step={1}
              value={draft.maxOutputTokens}
              className="h-8 text-xs tabular-nums"
              aria-label="最大输出 Token"
              placeholder="未知"
              onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.currentTarget.value })}
            />
          </EditorRow>
        </section>

        <section className="border-t border-border pt-5" aria-labelledby="endpoint-bindings-title">
          <div>
            <h3 id="endpoint-bindings-title" className="text-[12px] font-semibold text-foreground">
              端点投递能力
            </h3>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              以下绑定来自供应商模型目录；原生联网不是模型固有开关。
            </p>
          </div>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {model.endpointBindings?.length ? (
              model.endpointBindings.map((binding) => (
                <div key={binding.endpointType} className="flex items-center gap-3 py-3">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${binding.nativeWebSearch === "supported" ? "bg-capability-web/10 text-capability-web" : "bg-muted text-muted-foreground"}`}
                  >
                    <Icon icon={AiWebBrowsingIcon} size={15} strokeWidth={1.9} />
                  </span>
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {binding.endpointType}
                  </code>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    原生联网 {CAPABILITY_STATE_LABELS[binding.nativeWebSearch]}
                    {binding.officialOnly ? " · 仅官方地址" : ""}
                  </span>
                </div>
              ))
            ) : (
              <p className="py-3 text-[11px] text-muted-foreground">当前模型没有生成端点绑定。</p>
            )}
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => {
            onSave({
              capabilities: draft.capabilities,
              contextWindow,
              inputModalities: draft.inputModalities,
              maxInputTokens: positiveInteger(draft.maxInputTokens),
              maxOutputTokens: positiveInteger(draft.maxOutputTokens),
              modelType: draft.modelType,
              name: draft.name.trim() || null,
              outputModalities: draft.outputModalities,
            })
          }}
        >
          保存模型
        </Button>
      </footer>
    </>
  )
}

export function ModelEditorDialog({
  model,
  onOpenChange,
  onSave,
}: {
  model: AiProviderModelDraft | null
  onOpenChange: (open: boolean) => void
  onSave: (update: AiProviderModelProfileUpdate) => void
}) {
  return (
    <Dialog open={model !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0" initialFocus={false}>
        {model ? (
          <ModelEditorForm key={model.id} model={model} onOpenChange={onOpenChange} onSave={onSave} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
