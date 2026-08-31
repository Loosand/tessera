/**
 * [INPUT]: 供应商设置纯状态、连接导航/总览、模型列表组件、持久化配置与类型化模型发现函数
 * [OUTPUT]: 编排可恢复配置、兼容协议多连接、加密密钥状态、目录检查、模型编辑与即时持久化的供应商详情视图
 * [POS]: @tessera/ai/react 模型供应商设置页的状态编排与连接详情入口
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
  EyeIcon,
  EyeOffIcon,
  Refresh01Icon,
  Search01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import {
  type AiProviderDefinition,
  type AiProviderDraft,
  type AiProviderDraftUpdate,
  type AiProviderId,
  type AiProviderModelDraft,
  appendAiProviderModel,
  createAiProviderDraft,
  createInitialAiProviderDrafts,
  mergeDiscoveredAiProviderModels,
  setAllAiProviderModelsEnabled,
  updateAiProviderModelProfile,
} from "../catalog/provider-catalog"
import { ModelEditorDialog } from "./model-editor-dialog"
import { ProviderModelGroup } from "./provider-model-list"
import { ProviderDirectory, ProviderMark, ProviderOverview, ProviderStatus } from "./provider-navigation"
import {
  ALL_PROVIDER_SELECTION,
  type ProviderSelection,
  draftFromConfig,
  findProviderDefinition,
  listProviderConnections,
  providerConfigSelection,
  saveInputFromDraft,
} from "./provider-settings-state"

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

export function AiProviderSettings({
  deleteConfig,
  listConfigs,
  listModels,
  saveConfig,
  subscribeToConfigChanges,
}: AiProviderSettingsProps) {
  const [selection, setSelection] = useState<ProviderSelection>(ALL_PROVIDER_SELECTION)
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

  const selectAllProviders = () => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0
    setSelection(ALL_PROVIDER_SELECTION)
  }

  const selectConfig = (configId: string) => {
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0
    setSelection((current) =>
      current.kind === "config" && current.configId === configId
        ? current
        : providerConfigSelection(configId),
    )
  }

  const addConnection = (providerId: AiProviderId) => {
    const provider = findProviderDefinition(providerId)
    if (!provider.multiple) {
      selectConfig(provider.id)
      return
    }

    const siblingCount = listProviderConnections(drafts).filter(
      ({ draft }) => draft.providerId === providerId,
    ).length
    const configId = `${providerId}:${globalThis.crypto.randomUUID()}`
    const draft = createAiProviderDraft(provider, configId, `${provider.name} ${siblingCount + 1}`)
    setDrafts((current) => ({ ...current, [configId]: draft }))
    selectConfig(configId)
  }

  const selectedConfigId = selection.kind === "config" ? selection.configId : null
  const selectedDraft = selectedConfigId ? drafts[selectedConfigId] : undefined
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
        onSelectAll={selectAllProviders}
        onSelectConfig={selectConfig}
        selectedConfigId={selectedConfigId}
      />
      <div ref={detailScrollRef} className="min-h-0 overflow-y-auto">
        {selectedConfigId === null ? (
          <ProviderOverview
            drafts={drafts}
            error={persistenceError}
            onAddConnection={addConnection}
            onOpenConfig={selectConfig}
            onUpdateProvider={persistOverviewUpdate}
          />
        ) : selectedProvider && selectedDraft ? (
          <ProviderDetail
            key={selectedConfigId}
            provider={selectedProvider}
            draft={selectedDraft}
            apiKey={apiKeys[selectedConfigId] ?? ""}
            onApiKeyChange={(apiKey) => setApiKeys((current) => ({ ...current, [selectedConfigId]: apiKey }))}
            onListModels={listModels}
            onPersist={(update) => persistProviderUpdate(selectedConfigId, update)}
            onSave={async (apiKey) => {
              const config = await saveConfig(saveInputFromDraft(selectedDraft, apiKey))
              replaceProvider(selectedConfigId, draftFromConfig(config))
              setApiKeys((current) => ({ ...current, [selectedConfigId]: "" }))
            }}
            onDelete={async () => {
              await deleteConfig(selectedDraft.configId)
              setApiKeys((current) => {
                const next = { ...current }
                delete next[selectedConfigId]
                return next
              })

              if (selectedDraft.configId === selectedDraft.providerId) {
                const defaultDraft = createAiProviderDraft(selectedProvider)
                setDrafts((current) => ({ ...current, [selectedConfigId]: defaultDraft }))
                return
              }

              setDrafts((current) => {
                const next = { ...current }
                delete next[selectedConfigId]
                return next
              })
              selectAllProviders()
            }}
            onUpdate={(update) => updateProvider(selectedConfigId, update)}
          />
        ) : null}
      </div>
    </div>
  )
}
