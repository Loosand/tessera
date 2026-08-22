/**
 * [INPUT]: 首批 AI API 供应商元数据、精选 LobeHub 品牌图标、持久化配置与类型化模型发现函数
 * [OUTPUT]: 可恢复配置、兼容协议多连接、加密密钥状态、目录检查、统一模型编辑与即时持久化的分组模型目录
 * [POS]: @tessera/ai/react 提供的模型供应商管理视图
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiProviderConfig,
  AiProviderConnectionInput,
  AiProviderModelListResult,
  AiProviderSaveInput,
} from "@tessera/contracts"
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Edit02Icon,
  EyeIcon,
  EyeOffIcon,
  ListViewIcon,
  Refresh01Icon,
  Search01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Switch } from "@tessera/design-system/components/ui/switch"
import {
  type ComponentType,
  type LazyExoticComponent,
  Suspense,
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AI_PROVIDER_DEFINITIONS,
  type AiProviderDefinition,
  type AiProviderDraft,
  type AiProviderDraftUpdate,
  type AiProviderDrafts,
  type AiProviderId,
  type AiProviderModelDraft,
  appendAiProviderModel,
  createAiProviderDraft,
  createInitialAiProviderDrafts,
  matchesAiProvider,
  mergeDiscoveredAiProviderModels,
  setAllAiProviderModelsEnabled,
  updateAiProviderModelProfile,
} from "../provider-catalog"
import { AiModelIcon } from "./ai-model-icon"
import { ModelEditorDialog } from "./model-editor-dialog"

type ProviderIconProps = { size?: number }
type LazyProviderIcon = LazyExoticComponent<ComponentType<ProviderIconProps>>

const PROVIDER_ICONS = {
  "openai-compatible": lazy(() => import("@lobehub/icons/es/OpenAI/components/Mono")),
  "anthropic-compatible": lazy(() => import("@lobehub/icons/es/Anthropic/components/Mono")),
  deepseek: lazy(() => import("@lobehub/icons/es/DeepSeek/components/Color")),
  grok: lazy(() => import("@lobehub/icons/es/XAI/components/Mono")),
  openrouter: lazy(() => import("@lobehub/icons/es/OpenRouter/components/Color")),
} satisfies Record<AiProviderId, LazyProviderIcon>

type ProviderSelection = "all" | string

type ProviderConnectionView = {
  draft: AiProviderDraft
  provider: AiProviderDefinition
}

function findProviderDefinition(providerId: AiProviderId): AiProviderDefinition {
  const provider = AI_PROVIDER_DEFINITIONS.find((candidate) => candidate.id === providerId)
  if (!provider) throw new Error(`未知的 AI 供应商协议：${providerId}`)
  return provider
}

function isAiProviderDraft(draft: AiProviderDraft | undefined): draft is AiProviderDraft {
  return draft !== undefined
}

function listProviderConnections(drafts: AiProviderDrafts): ProviderConnectionView[] {
  return Object.values(drafts)
    .filter(isAiProviderDraft)
    .map((draft) => ({
      draft,
      provider: findProviderDefinition(draft.providerId),
    }))
}

function ProviderMark({ provider, size = "lg" }: { provider: AiProviderDefinition; size?: "sm" | "lg" }) {
  const compact = size === "sm"
  const ProviderIcon = PROVIDER_ICONS[provider.id]

  return (
    <span
      className={`flex shrink-0 items-center justify-center border border-border bg-muted ${compact ? "size-8 rounded-md" : "size-11 rounded-lg"}`}
      aria-hidden="true"
    >
      <Suspense
        fallback={<span className={`${compact ? "size-4.5" : "size-6"} animate-pulse rounded bg-muted`} />}
      >
        <ProviderIcon size={compact ? 18 : 24} />
      </Suspense>
    </span>
  )
}

function ProviderStatus({ configured }: { configured: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {configured ? (
        <Icon icon={CheckmarkCircle02Icon} size={14} />
      ) : (
        <span className="size-1.5 rounded-full bg-input" />
      )}
      {configured ? "已配置" : "待配置"}
    </span>
  )
}

type ProviderDirectoryProps = {
  drafts: AiProviderDrafts
  onAddConnection: (providerId: AiProviderId) => void
  onSelectProvider: (providerId: ProviderSelection) => void
  selectedProviderId: ProviderSelection
}

function ProviderDirectory({
  drafts,
  onAddConnection,
  onSelectProvider,
  selectedProviderId,
}: ProviderDirectoryProps) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const connections = useMemo(() => listProviderConnections(drafts), [drafts])
  const visibleConnections = useMemo(
    () =>
      connections.filter(({ draft, provider }) =>
        matchesAiProvider(provider, deferredQuery, draft.displayName),
      ),
    [connections, deferredQuery],
  )
  const enabledConnections = visibleConnections.filter(({ draft }) => draft.enabled)
  const availableConnections = visibleConnections.filter(({ draft }) => !draft.enabled)

  const renderConnections = (items: readonly ProviderConnectionView[]) => (
    <div className="space-y-0.5">
      {items.map(({ draft, provider }) => (
        <button
          key={draft.configId}
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
          data-active={draft.configId === selectedProviderId || undefined}
          aria-current={draft.configId === selectedProviderId ? "page" : undefined}
          onClick={() => onSelectProvider(draft.configId)}
        >
          <ProviderMark provider={provider} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{draft.displayName}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {provider.multiple ? `${provider.name} · ` : ""}
              {provider.protocol}
            </span>
          </span>
          <span
            className={`size-1.5 shrink-0 rounded-full ${draft.apiKeyConfigured ? "bg-foreground" : "bg-input"}`}
            title={draft.apiKeyConfigured ? "已配置" : "待配置"}
            aria-hidden="true"
          />
          <span className="sr-only">{draft.apiKeyConfigured ? "已配置" : "待配置"}</span>
        </button>
      ))}
    </div>
  )

  return (
    <aside className="flex min-h-0 flex-col border-b border-border bg-sidebar min-[900px]:border-r min-[900px]:border-b-0">
      <header className="shrink-0 border-b border-border px-3 pt-4 pb-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <div>
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">设置</p>
            <h1 className="mt-1 text-[15px] font-medium">模型供应商</h1>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{connections.length}</span>
        </div>
        <div className="relative mt-3">
          <Icon
            icon={Search01Icon}
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            className="h-8 border-transparent bg-background/80 pl-8 text-[12px] shadow-none"
            placeholder="搜索供应商"
            aria-label="搜索 AI 供应商"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      </header>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="模型供应商">
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
          data-active={selectedProviderId === "all" || undefined}
          aria-current={selectedProviderId === "all" ? "page" : undefined}
          onClick={() => onSelectProvider("all")}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground"
            aria-hidden="true"
          >
            <Icon icon={ListViewIcon} size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">全部供应商</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{connections.length}</span>
        </button>

        {enabledConnections.length > 0 ? (
          <section aria-labelledby="enabled-ai-providers">
            <h2
              id="enabled-ai-providers"
              className="px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              已启用
            </h2>
            {renderConnections(enabledConnections)}
          </section>
        ) : null}

        {availableConnections.length > 0 ? (
          <section
            className={enabledConnections.length > 0 ? "mt-3" : undefined}
            aria-labelledby="other-ai-providers"
          >
            <h2
              id="other-ai-providers"
              className="px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
            >
              {enabledConnections.length > 0 ? "其他" : "全部"}
            </h2>
            {renderConnections(availableConnections)}
          </section>
        ) : null}

        {visibleConnections.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[12px] font-medium">没有匹配的供应商</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">换一个名称或协议关键词试试。</p>
          </div>
        ) : null}

        <section className="mt-4 border-t border-border pt-3" aria-label="添加兼容连接">
          <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            添加连接
          </p>
          {AI_PROVIDER_DEFINITIONS.filter((provider) => provider.multiple).map((provider) => (
            <Button
              key={provider.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start text-[12px] text-muted-foreground"
              onClick={() => onAddConnection(provider.id)}
            >
              <Icon icon={Add01Icon} size={14} />
              {provider.name}
            </Button>
          ))}
        </section>
      </nav>
    </aside>
  )
}

type ProviderOverviewProps = {
  drafts: AiProviderDrafts
  error: string | null
  onAddConnection: (providerId: AiProviderId) => void
  onOpenProvider: (configId: string) => void
  onUpdateProvider: (configId: string, update: AiProviderDraftUpdate) => void
}

function ProviderOverview({
  drafts,
  error,
  onAddConnection,
  onOpenProvider,
  onUpdateProvider,
}: ProviderOverviewProps) {
  const connections = listProviderConnections(drafts)
  const enabledConnections = connections.filter(({ draft }) => draft.enabled)
  const availableConnections = connections.filter(({ draft }) => !draft.enabled)

  const renderGroup = (title: string, items: readonly ProviderConnectionView[]) => {
    if (items.length === 0) return null

    return (
      <section className="space-y-3" aria-label={title}>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-medium">{title}</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {items.map(({ draft, provider }) => {
            return (
              <article
                key={draft.configId}
                className="flex min-h-40 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 p-4 text-left"
                  onClick={() => onOpenProvider(draft.configId)}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderMark provider={provider} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{draft.displayName}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {provider.multiple ? `${provider.name} · ` : ""}
                        {provider.protocol}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 min-h-10 text-[12px] leading-5 text-muted-foreground">
                    {provider.description}
                  </p>
                </button>
                <footer className="flex items-center justify-between border-t border-border px-4 py-2.5">
                  <ProviderStatus configured={draft.apiKeyConfigured} />
                  <Switch
                    checked={draft.enabled}
                    size="sm"
                    onCheckedChange={(enabled) => onUpdateProvider(draft.configId, { enabled })}
                    aria-label={`${draft.enabled ? "停用" : "启用"}${draft.displayName}`}
                  />
                </footer>
              </article>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <section className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-[clamp(20px,4vw,48px)] py-8 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              模型供应商
            </p>
            <h1 className="mt-1 text-xl font-medium tracking-[-0.02em]">全部连接</h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              官方供应商保持单例；兼容协议可建立多个命名连接。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AI_PROVIDER_DEFINITIONS.filter((provider) => provider.multiple).map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                size="sm"
                onClick={() => onAddConnection(provider.id)}
              >
                <Icon icon={Add01Icon} size={14} />
                添加{provider.name}
              </Button>
            ))}
          </div>
        </header>
        {error ? (
          <p
            className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {renderGroup("已启用", enabledConnections)}
        {renderGroup(enabledConnections.length > 0 ? "未启用" : "可用连接", availableConnections)}
      </div>
    </section>
  )
}

type ProviderDetailProps = {
  apiKey: string
  draft: AiProviderDraft
  onApiKeyChange: (apiKey: string) => void
  onDelete: () => Promise<void>
  onListModels: (input: AiProviderConnectionInput) => Promise<AiProviderModelListResult>
  onPersist: (update: AiProviderDraftUpdate) => Promise<void>
  onSave: (apiKey: string) => Promise<void>
  onUpdate: (update: AiProviderDraftUpdate) => void
  provider: AiProviderDefinition
}

type ProviderNotice = {
  kind: "error" | "info" | "success"
  scope: "connection" | "models"
  text: string
}

function formatTokenLimit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

type ProviderModelGroupProps = {
  disabled: boolean
  label: string
  models: readonly AiProviderModelDraft[]
  onDelete: (modelId: string) => void
  onEdit: (modelId: string) => void
  onToggle: (modelId: string, enabled: boolean) => void
}

function ProviderModelGroup({
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
              {model.ownedBy || model.modelType || model.contextWindow || model.maxOutputTokens ? (
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  {model.ownedBy ? <span>{model.ownedBy}</span> : null}
                  {model.modelType ? <span>{model.modelType}</span> : null}
                  {model.contextWindow ? <span>上下文 {formatTokenLimit(model.contextWindow)}</span> : null}
                  {model.maxOutputTokens ? (
                    <span>最大输出 {formatTokenLimit(model.maxOutputTokens)}</span>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-muted-foreground">
                {model.inputModalities?.length ? <span>输入 {model.inputModalities.join("/")}</span> : null}
                {model.capabilities?.functionCall === "supported" ? <span>工具</span> : null}
                {model.capabilities?.reasoning === "supported" ? <span>推理</span> : null}
                {model.endpointBindings?.some((binding) => binding.nativeWebSearch === "supported") ? (
                  <span>原生联网</span>
                ) : null}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={`编辑模型 ${model.id}`}
              onClick={() => onEdit(model.id)}
            >
              <Icon icon={Edit02Icon} size={14} />
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

function ProviderDetail({
  apiKey,
  draft,
  onApiKeyChange,
  onDelete,
  onListModels,
  onPersist,
  onSave,
  onUpdate,
  provider,
}: ProviderDetailProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [showModelInput, setShowModelInput] = useState(false)
  const [modelInput, setModelInput] = useState("")
  const [modelSearch, setModelSearch] = useState("")
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const deferredModelSearch = useDeferredValue(modelSearch)
  const [notice, setNotice] = useState<ProviderNotice | null>(null)
  const [activeRequest, setActiveRequest] = useState<
    "connection" | "delete" | "model-state" | "models" | "save" | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const automaticCatalogRequest = useRef(false)
  const normalizedModelSearch = deferredModelSearch.trim().toLocaleLowerCase()
  const visibleModels = useMemo(
    () =>
      draft.models.filter((model) =>
        `${model.name ?? ""} ${model.id}`.toLocaleLowerCase().includes(normalizedModelSearch),
      ),
    [draft.models, normalizedModelSearch],
  )
  const visibleModelGroups = useMemo(
    () => ({
      disabled: visibleModels.filter((model) => !model.enabled),
      enabled: visibleModels.filter((model) => model.enabled),
    }),
    [visibleModels],
  )
  const hasModels = draft.models.length > 0
  const allModelsEnabled = hasModels && draft.models.every((model) => model.enabled)
  const allModelsDisabled = hasModels && draft.models.every((model) => !model.enabled)
  const editingModel = draft.models.find((model) => model.id === editingModelId) ?? null

  const persistModels = useCallback(
    async (models: readonly AiProviderModelDraft[], successText: string) => {
      setActiveRequest("model-state")
      setNotice(null)
      try {
        await onPersist({ models: [...models] })
        setNotice({ kind: "success", scope: "models", text: successText })
      } catch (error) {
        setNotice({
          kind: "error",
          scope: "models",
          text: error instanceof Error ? error.message : "保存模型配置失败。",
        })
      } finally {
        setActiveRequest(null)
      }
    },
    [onPersist],
  )

  const addModel = () => {
    const models = appendAiProviderModel(draft.models, modelInput, provider.id)
    if (models.length === draft.models.length) return
    setModelInput("")
    setShowModelInput(false)
    void persistModels(models, "模型已添加并保存。")
  }

  const persistProviderEnabled = async (enabled: boolean) => {
    setActiveRequest("save")
    setNotice(null)
    try {
      await onPersist({ enabled })
      setNotice({
        kind: "success",
        scope: "connection",
        text: enabled ? "连接已启用。" : "连接已停用。",
      })
    } catch (error) {
      setNotice({
        kind: "error",
        scope: "connection",
        text: error instanceof Error ? error.message : "保存连接状态失败。",
      })
    } finally {
      setActiveRequest(null)
    }
  }

  const saveConfig = async () => {
    setActiveRequest("save")
    setNotice(null)
    try {
      await onSave(apiKey.trim())
      onApiKeyChange("")
      setConfirmDelete(false)
      setNotice({
        kind: "success",
        scope: "connection",
        text: "配置已保存；API Key 由主进程通过系统安全存储加密。",
      })
    } catch (error) {
      setNotice({
        kind: "error",
        scope: "connection",
        text: error instanceof Error ? error.message : "保存连接配置失败。",
      })
    } finally {
      setActiveRequest(null)
    }
  }

  const deleteConfig = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setNotice({
        kind: "error",
        scope: "connection",
        text: "再次点击“确认删除”将移除 Base URL、模型开关和已加密的 API Key。",
      })
      return
    }
    setActiveRequest("delete")
    setNotice(null)
    try {
      await onDelete()
      onApiKeyChange("")
      setConfirmDelete(false)
      setNotice({ kind: "success", scope: "connection", text: "连接配置已删除。" })
    } catch (error) {
      setNotice({
        kind: "error",
        scope: "connection",
        text: error instanceof Error ? error.message : "删除连接配置失败。",
      })
    } finally {
      setActiveRequest(null)
    }
  }

  const requestModels = useCallback(
    async (scope: "connection" | "models") => {
      setActiveRequest(scope)
      setNotice(null)
      try {
        const result = await onListModels({
          configId: draft.configId,
          providerId: provider.id,
          apiKey: apiKey.trim(),
          baseUrl: draft.baseUrl.trim(),
        })
        if (!result.ok) {
          if (result.code === "catalog-unsupported") {
            setNotice({
              kind: "info",
              scope,
              text: `${result.error} 这不影响保存连接或调用已知模型，请在下方手动添加模型 ID。`,
            })
            return
          }
          throw new Error(result.error)
        }
        const models = result.models
        if (scope === "models") {
          const mergedModels = mergeDiscoveredAiProviderModels(draft.models, models, provider.id)
          await onPersist({ models: mergedModels })
          setNotice({
            kind: "success",
            scope,
            text:
              models.length > 0
                ? `已同步并保存 ${models.length} 个模型，当前列表共 ${mergedModels.length} 个；只有单模型目录会自动启用。`
                : "目录可访问，但服务返回了空模型列表，现有配置已保存。",
          })
        } else {
          setNotice({
            kind: "success",
            scope,
            text: `模型目录可访问（${models.length} 个模型）。`,
          })
        }
      } catch (error) {
        setNotice({
          kind: "error",
          scope,
          text: error instanceof Error ? error.message : "模型目录请求失败。",
        })
      } finally {
        setActiveRequest(null)
      }
    },
    [apiKey, draft.baseUrl, draft.configId, draft.models, onListModels, onPersist, provider.id],
  )

  const hasBaseUrl = draft.baseUrl.trim().length > 0
  const canTestConnection =
    hasBaseUrl && (apiKey.trim().length > 0 || draft.apiKeyConfigured || provider.publicModelCatalog)

  useEffect(() => {
    if (
      automaticCatalogRequest.current ||
      !provider.publicModelCatalog ||
      draft.models.length > 0 ||
      draft.baseUrl.trim() !== provider.defaultBaseUrl
    ) {
      return
    }
    automaticCatalogRequest.current = true
    void requestModels("models")
  }, [
    draft.baseUrl,
    draft.models.length,
    provider.defaultBaseUrl,
    provider.publicModelCatalog,
    requestModels,
  ])

  return (
    <section className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-7 px-[clamp(20px,4vw,48px)] py-8 pb-24">
        <header className="flex items-start justify-between gap-6 border-b border-border pb-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <ProviderMark provider={provider} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-xl font-medium tracking-[-0.02em]">{draft.displayName}</h2>
                <ProviderStatus configured={draft.apiKeyConfigured} />
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
                {provider.description}
              </p>
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                {provider.multiple ? `${provider.name} · ` : ""}
                {provider.protocol} · {provider.adapter}
              </p>
            </div>
          </div>
          <Switch
            checked={draft.enabled}
            disabled={activeRequest !== null}
            onCheckedChange={(enabled) => void persistProviderEnabled(enabled)}
            aria-label={`${draft.enabled ? "停用" : "启用"}${draft.displayName}`}
          />
        </header>

        <section className="space-y-3" aria-labelledby="provider-connection-heading">
          <div>
            <h3 id="provider-connection-heading" className="text-[15px] font-medium">
              连接配置
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              API Key 只保留在当前应用会话；请求通过主进程安全边界发送。
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className={`grid gap-4 p-4 ${provider.multiple ? "xl:grid-cols-3" : "2xl:grid-cols-2"}`}>
              {provider.multiple ? (
                <label className="block min-w-0" htmlFor="provider-display-name">
                  <span className="text-[12px] font-medium">连接名称</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    用于区分同一种兼容协议下的不同服务或账户。
                  </span>
                  <Input
                    id="provider-display-name"
                    value={draft.displayName}
                    className="mt-2 h-9"
                    placeholder={provider.name}
                    aria-label="连接名称"
                    onChange={(event) => {
                      onUpdate({ displayName: event.currentTarget.value })
                      setNotice(null)
                    }}
                  />
                </label>
              ) : null}
              <label className="block min-w-0" htmlFor="provider-api-key">
                <span className="text-[12px] font-medium">API Key</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {draft.apiKeyConfigured
                    ? "已由系统安全存储加密保存；留空不会修改，输入新 Key 可替换。"
                    : "输入供应商或兼容服务提供的密钥。"}
                </span>
                <span className="relative mt-2 block">
                  <Input
                    id="provider-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    className="h-9 pr-10"
                    placeholder={
                      draft.apiKeyConfigured ? "已安全保存；输入新 Key 可替换" : provider.apiKeyPlaceholder
                    }
                    aria-label={`${provider.name} API Key`}
                    autoComplete="off"
                    onChange={(event) => {
                      onApiKeyChange(event.currentTarget.value)
                      setNotice(null)
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1 right-1 text-muted-foreground"
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    onClick={() => setShowApiKey((current) => !current)}
                  >
                    <Icon icon={showApiKey ? EyeOffIcon : EyeIcon} size={15} />
                  </Button>
                </span>
              </label>

              <label className="block min-w-0" htmlFor="provider-api-base-url">
                <span className="text-[12px] font-medium">API 地址</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  默认使用官方地址，代理、中转或兼容服务可在此覆盖。
                </span>
                <Input
                  id="provider-api-base-url"
                  value={draft.baseUrl}
                  className="mt-2 h-9"
                  placeholder={provider.defaultBaseUrl}
                  aria-label={`${provider.name} Base URL`}
                  spellCheck={false}
                  onChange={(event) => {
                    onUpdate({ baseUrl: event.currentTarget.value })
                    setNotice(null)
                  }}
                />
              </label>
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              {notice?.scope === "connection" ? (
                <p
                  className={`mr-auto text-xs leading-5 ${notice.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
                  role={notice.kind === "error" ? "alert" : "status"}
                >
                  {notice.text}
                </p>
              ) : null}
              <Button
                variant="destructive"
                size="sm"
                className="mr-auto"
                disabled={activeRequest !== null}
                onClick={() => void deleteConfig()}
              >
                {activeRequest === "delete" ? "删除中" : confirmDelete ? "确认删除" : "删除配置"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canTestConnection || activeRequest !== null}
                onClick={() => void requestModels("connection")}
              >
                {activeRequest === "connection" ? (
                  <Icon icon={Refresh01Icon} size={13} className="animate-spin" />
                ) : null}
                {activeRequest === "connection" ? "检查中" : "检查目录"}
              </Button>
              <Button
                size="sm"
                disabled={!hasBaseUrl || activeRequest !== null}
                onClick={() => void saveConfig()}
              >
                {activeRequest === "save" ? "保存中" : "保存配置"}
              </Button>
            </footer>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="provider-models-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <h3 id="provider-models-heading" className="text-[15px] font-medium">
                  模型列表
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground">{draft.models.length}</span>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                从模型目录同步，或手动补充完整模型 ID。
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-border bg-card p-3">
              <div className="relative min-w-48 flex-1">
                <Icon
                  icon={Search01Icon}
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={modelSearch}
                  className="h-8 pl-9 text-[12px]"
                  placeholder="搜索模型名称或 ID"
                  aria-label="搜索模型"
                  onChange={(event) => setModelSearch(event.currentTarget.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasModels || allModelsEnabled || activeRequest !== null}
                onClick={() =>
                  void persistModels(
                    setAllAiProviderModelsEnabled(draft.models, true),
                    "全部模型已启用并保存。",
                  )
                }
              >
                全部启用
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasModels || allModelsDisabled || activeRequest !== null}
                onClick={() =>
                  void persistModels(
                    setAllAiProviderModelsEnabled(draft.models, false),
                    "全部模型已停用并保存。",
                  )
                }
              >
                全部停用
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasBaseUrl || activeRequest !== null}
                onClick={() => void requestModels("models")}
              >
                <Icon
                  icon={Refresh01Icon}
                  size={13}
                  className={activeRequest === "models" ? "animate-spin" : undefined}
                />
                {activeRequest === "models" ? "同步中" : "同步模型"}
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={activeRequest !== null}
                aria-label={showModelInput ? "收起模型输入" : "手动添加模型"}
                aria-expanded={showModelInput}
                onClick={() => setShowModelInput((current) => !current)}
              >
                <Icon icon={Add01Icon} size={14} />
              </Button>
            </div>

            {showModelInput ? (
              <div className="flex gap-2 border-b border-border bg-muted/25 p-3">
                <Input
                  value={modelInput}
                  className="h-8 min-w-0 flex-1 text-[12px]"
                  placeholder="输入完整模型 ID"
                  aria-label="模型 ID"
                  spellCheck={false}
                  onChange={(event) => setModelInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && activeRequest === null) addModel()
                  }}
                />
                <Button size="sm" onClick={addModel} disabled={!modelInput.trim() || activeRequest !== null}>
                  添加
                </Button>
              </div>
            ) : null}

            {notice?.scope === "models" ? (
              <div
                className={`border-b border-border px-4 py-3 text-xs leading-5 ${notice.kind === "error" ? "bg-destructive/5 text-destructive" : "bg-muted/35 text-muted-foreground"}`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.text}
              </div>
            ) : null}

            {visibleModels.length > 0 ? (
              <div>
                <ProviderModelGroup
                  disabled={activeRequest !== null}
                  label="已启用"
                  models={visibleModelGroups.enabled}
                  onEdit={setEditingModelId}
                  onToggle={(modelId, enabled) =>
                    void persistModels(
                      draft.models.map((model) => (model.id === modelId ? { ...model, enabled } : model)),
                      `模型已${enabled ? "启用" : "停用"}并保存。`,
                    )
                  }
                  onDelete={(modelId) =>
                    void persistModels(
                      draft.models.filter((model) => model.id !== modelId),
                      "模型已删除并保存。",
                    )
                  }
                />
                <ProviderModelGroup
                  disabled={activeRequest !== null}
                  label="未启用"
                  models={visibleModelGroups.disabled}
                  onEdit={setEditingModelId}
                  onToggle={(modelId, enabled) =>
                    void persistModels(
                      draft.models.map((model) => (model.id === modelId ? { ...model, enabled } : model)),
                      `模型已${enabled ? "启用" : "停用"}并保存。`,
                    )
                  }
                  onDelete={(modelId) =>
                    void persistModels(
                      draft.models.filter((model) => model.id !== modelId),
                      "模型已删除并保存。",
                    )
                  }
                />
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="text-[13px] font-medium">
                  {draft.models.length > 0 ? "没有匹配的模型" : "还没有模型"}
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {draft.models.length > 0 ? "换一个模型名称或 ID 试试。" : "同步目录或手动添加模型。"}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <ModelEditorDialog
        model={editingModel}
        onOpenChange={(open) => {
          if (!open) setEditingModelId(null)
        }}
        onSave={(update) => {
          if (!editingModelId) return
          const models = updateAiProviderModelProfile(draft.models, editingModelId, update, provider.id)
          setEditingModelId(null)
          void persistModels(models, "模型信息已更新并保存。")
        }}
      />
    </section>
  )
}

export type AiProviderSettingsProps = {
  deleteConfig: (configId: string) => Promise<void>
  listConfigs: () => Promise<AiProviderConfig[]>
  listModels: (input: AiProviderConnectionInput) => Promise<AiProviderModelListResult>
  saveConfig: (input: AiProviderSaveInput) => Promise<AiProviderConfig>
  subscribeToConfigChanges?: (listener: () => void) => () => void
}

function draftFromConfig(config: AiProviderConfig): AiProviderDraft {
  return {
    apiKeyConfigured: config.apiKeyConfigured,
    baseUrl: config.baseUrl,
    configId: config.configId,
    displayName: config.displayName,
    enabled: config.enabled,
    models: config.models.map((model) => ({ ...model })),
    providerId: config.providerId,
  }
}

function saveInputFromDraft(draft: AiProviderDraft, apiKey = ""): AiProviderSaveInput {
  return {
    configId: draft.configId,
    displayName: draft.displayName,
    providerId: draft.providerId,
    enabled: draft.enabled,
    baseUrl: draft.baseUrl,
    models: draft.models.map((model) => ({ ...model })),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  }
}

export function AiProviderSettings({
  deleteConfig,
  listConfigs,
  listModels,
  saveConfig,
  subscribeToConfigChanges,
}: AiProviderSettingsProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderSelection>("all")
  const [drafts, setDrafts] = useState(createInitialAiProviderDrafts)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [initialized, setInitialized] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const detailScrollRef = useRef<HTMLDivElement>(null)

  const reloadConfigs = useCallback(async () => {
    try {
      const configs = await listConfigs()
      setDrafts(createInitialAiProviderDrafts(configs))
      setPersistenceError(null)
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "读取供应商配置失败。")
    } finally {
      setInitialized(true)
    }
  }, [listConfigs])

  useEffect(() => {
    void reloadConfigs()
    return subscribeToConfigChanges?.(() => void reloadConfigs())
  }, [reloadConfigs, subscribeToConfigChanges])

  const updateProvider = (configId: string, update: AiProviderDraftUpdate) => {
    setDrafts((current) => {
      const currentDraft = current[configId]
      if (!currentDraft) return current
      return {
        ...current,
        [configId]: { ...currentDraft, ...update },
      }
    })
  }

  const replaceProvider = (configId: string, draft: AiProviderDraft) => {
    setDrafts((current) => ({ ...current, [configId]: draft }))
  }

  const selectProvider = (providerId: ProviderSelection) => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0
    setSelectedProviderId(providerId)
  }

  const addConnection = (providerId: AiProviderId) => {
    const provider = findProviderDefinition(providerId)
    if (!provider.multiple) {
      selectProvider(provider.id)
      return
    }

    const siblingCount = listProviderConnections(drafts).filter(
      ({ draft }) => draft.providerId === providerId,
    ).length
    const configId = `${providerId}:${globalThis.crypto.randomUUID()}`
    const draft = createAiProviderDraft(provider, configId, `${provider.name} ${siblingCount + 1}`)
    setDrafts((current) => ({ ...current, [configId]: draft }))
    selectProvider(configId)
  }

  const selectedDraft = selectedProviderId === "all" ? undefined : drafts[selectedProviderId]
  const selectedProvider = selectedDraft ? findProviderDefinition(selectedDraft.providerId) : undefined

  const persistProviderUpdate = async (configId: string, update: AiProviderDraftUpdate): Promise<void> => {
    const previous = drafts[configId]
    if (!previous) throw new Error("连接配置不存在或已被删除。")
    const next = { ...previous, ...update }
    updateProvider(configId, update)
    setPersistenceError(null)
    try {
      const config = await saveConfig(saveInputFromDraft(next))
      replaceProvider(configId, draftFromConfig(config))
    } catch (error) {
      replaceProvider(configId, previous)
      setPersistenceError(error instanceof Error ? error.message : "保存连接配置失败。")
      throw error
    }
  }

  const persistOverviewUpdate = (configId: string, update: AiProviderDraftUpdate) => {
    void persistProviderUpdate(configId, update).catch(() => undefined)
  }

  if (!initialized) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background text-sm text-muted-foreground">
        正在读取供应商配置…
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(180px,36vh)_minmax(0,1fr)] min-[900px]:grid-cols-[240px_minmax(0,1fr)] min-[900px]:grid-rows-1">
      <ProviderDirectory
        drafts={drafts}
        onAddConnection={addConnection}
        selectedProviderId={selectedProviderId}
        onSelectProvider={selectProvider}
      />
      <div ref={detailScrollRef} className="min-h-0 overflow-y-auto">
        {selectedProviderId === "all" ? (
          <ProviderOverview
            drafts={drafts}
            error={persistenceError}
            onAddConnection={addConnection}
            onOpenProvider={selectProvider}
            onUpdateProvider={persistOverviewUpdate}
          />
        ) : selectedProvider && selectedDraft ? (
          <ProviderDetail
            key={selectedProviderId}
            provider={selectedProvider}
            draft={selectedDraft}
            apiKey={apiKeys[selectedProviderId] ?? ""}
            onApiKeyChange={(apiKey) =>
              setApiKeys((current) => ({ ...current, [selectedProviderId]: apiKey }))
            }
            onListModels={listModels}
            onPersist={(update) => persistProviderUpdate(selectedProviderId, update)}
            onSave={async (apiKey) => {
              const config = await saveConfig(saveInputFromDraft(selectedDraft, apiKey))
              replaceProvider(selectedProviderId, draftFromConfig(config))
              setApiKeys((current) => ({ ...current, [selectedProviderId]: "" }))
            }}
            onDelete={async () => {
              await deleteConfig(selectedDraft.configId)
              setApiKeys((current) => {
                const next = { ...current }
                delete next[selectedProviderId]
                return next
              })

              if (selectedDraft.configId === selectedDraft.providerId) {
                const defaultDraft = createAiProviderDraft(selectedProvider)
                setDrafts((current) => ({ ...current, [selectedProviderId]: defaultDraft }))
                return
              }

              setDrafts((current) => {
                const next = { ...current }
                delete next[selectedProviderId]
                return next
              })
              selectProvider("all")
            }}
            onUpdate={(update) => updateProvider(selectedProviderId, update)}
          />
        ) : null}
      </div>
    </div>
  )
}
