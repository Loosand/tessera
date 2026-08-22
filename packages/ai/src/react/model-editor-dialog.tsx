/**
 * [INPUT]: 已归一化供应商模型草稿、打开状态与保存回调
 * [OUTPUT]: 可编辑模型类型、模态、固有能力、Token 限额并只读展示端点投递能力的配置对话框
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
import { Button } from "@tessera/design-system/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@tessera/design-system/components/ui/dialog"
import { Input } from "@tessera/design-system/components/ui/input"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { useEffect, useState } from "react"
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
  functionCall: "工具调用",
  reasoning: "推理",
  structuredOutput: "结构化输出",
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

function SourceBadge({ source }: { source: AiModelCapabilitySource | undefined }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
      {SOURCE_LABELS[source ?? "unknown"]}
    </span>
  )
}

function ModalityFields({
  label,
  modalities,
  onChange,
}: {
  label: string
  modalities: AiModelModality[]
  onChange: (modalities: AiModelModality[]) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[12px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {AI_MODEL_MODALITIES.map((modality) => (
          <label
            key={modality}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${modalities.includes(modality) ? "border-foreground/30 bg-muted text-foreground" : "border-border text-muted-foreground"}`}
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

export function ModelEditorDialog({
  model,
  onOpenChange,
  onSave,
}: {
  model: AiProviderModelDraft | null
  onOpenChange: (open: boolean) => void
  onSave: (update: AiProviderModelProfileUpdate) => void
}) {
  const [draft, setDraft] = useState<ModelEditorDraft | null>(model ? createDraft(model) : null)

  useEffect(() => {
    setDraft(model ? createDraft(model) : null)
  }, [model])

  const valid = Boolean(draft && draft.inputModalities.length > 0 && draft.outputModalities.length > 0)

  return (
    <Dialog open={model !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0" initialFocus={false}>
        {model && draft ? (
          <>
            <header className="border-b border-border px-5 py-4">
              <DialogTitle>编辑模型</DialogTitle>
              <DialogDescription>
                模型固有能力在这里维护；联网搜索按下方供应商端点绑定单独计算。
              </DialogDescription>
            </header>

            <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-4">
              <section className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 sm:col-span-2" htmlFor="model-editor-id">
                  <span className="text-[12px] font-medium">模型 ID</span>
                  <Input id="model-editor-id" value={model.id} disabled className="h-8 font-mono text-xs" />
                </label>
                <label className="space-y-1.5" htmlFor="model-editor-name">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    显示名称 <SourceBadge source={model.fieldSources?.name} />
                  </span>
                  <Input
                    id="model-editor-name"
                    value={draft.name}
                    className="h-8 text-xs"
                    placeholder={model.id}
                    onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                  />
                </label>
                <label className="space-y-1.5" htmlFor="model-editor-type">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    模型类型 <SourceBadge source={model.fieldSources?.modelType} />
                  </span>
                  <NativeSelect
                    id="model-editor-type"
                    value={draft.modelType}
                    containerClassName="w-full"
                    className="w-full"
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
                </label>
              </section>

              <section className="space-y-3 rounded-xl border border-border p-3.5">
                <h3 className="text-[12px] font-medium">模型能力</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(Object.keys(CAPABILITY_LABELS) as AiModelCapabilityKey[]).map((capability) => (
                    <label
                      key={capability}
                      className="space-y-1.5"
                      htmlFor={`model-editor-capability-${capability}`}
                    >
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {CAPABILITY_LABELS[capability]}
                        <SourceBadge source={model.capabilitySources?.[capability]} />
                      </span>
                      <NativeSelect
                        id={`model-editor-capability-${capability}`}
                        value={draft.capabilities[capability]}
                        containerClassName="w-full"
                        className="w-full"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            capabilities: {
                              ...draft.capabilities,
                              [capability]: event.currentTarget.value as AiModelCapabilityState,
                            },
                          })
                        }
                      >
                        {(Object.keys(CAPABILITY_STATE_LABELS) as AiModelCapabilityState[]).map((state) => (
                          <option key={state} value={state}>
                            {CAPABILITY_STATE_LABELS[state]}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                  ))}
                </div>
              </section>

              <section className="grid gap-4 rounded-xl border border-border p-3.5 sm:grid-cols-2">
                <ModalityFields
                  label="输入模态"
                  modalities={draft.inputModalities}
                  onChange={(inputModalities) => setDraft({ ...draft, inputModalities })}
                />
                <ModalityFields
                  label="输出模态"
                  modalities={draft.outputModalities}
                  onChange={(outputModalities) => setDraft({ ...draft, outputModalities })}
                />
              </section>

              <section className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["contextWindow", "上下文窗口"],
                    ["maxInputTokens", "最大输入 Token"],
                    ["maxOutputTokens", "最大输出 Token"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="space-y-1.5" htmlFor={`model-editor-${field}`}>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {label} <SourceBadge source={model.fieldSources?.[field]} />
                    </span>
                    <Input
                      id={`model-editor-${field}`}
                      type="number"
                      min={1}
                      step={1}
                      value={draft[field]}
                      className="h-8 text-xs"
                      placeholder="未知"
                      onChange={(event) => setDraft({ ...draft, [field]: event.currentTarget.value })}
                    />
                  </label>
                ))}
              </section>

              <section className="space-y-2 rounded-xl border border-border p-3.5">
                <div>
                  <h3 className="text-[12px] font-medium">端点投递能力</h3>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    这些绑定来自供应商模型目录，原生联网并不是模型固有开关。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {model.endpointBindings?.length ? (
                    model.endpointBindings.map((binding) => (
                      <span
                        key={binding.endpointType}
                        className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[10px]"
                      >
                        <span className="font-mono">{binding.endpointType}</span>
                        <span className="ml-2 text-muted-foreground">
                          原生联网 {CAPABILITY_STATE_LABELS[binding.nativeWebSearch]}
                          {binding.officialOnly ? " · 仅官方地址" : ""}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">当前模型没有生成端点绑定。</span>
                  )}
                </div>
              </section>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={!valid}
                onClick={() => {
                  onSave({
                    capabilities: draft.capabilities,
                    contextWindow: positiveInteger(draft.contextWindow),
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
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
