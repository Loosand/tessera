/**
 * [INPUT]: 首批 AI API 供应商元数据与用户在当前会话中的配置草稿
 * [OUTPUT]: AI 可用性、供应商总览、搜索和供应商详情配置界面
 * [POS]: @tessera/ai/react 提供的供应商管理功能视图
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import anthropicIconUrl from "@lobehub/icons-static-svg/icons/anthropic.svg"
import deepSeekIconUrl from "@lobehub/icons-static-svg/icons/deepseek-color.svg"
import grokIconUrl from "@lobehub/icons-static-svg/icons/grok.svg"
import openAiIconUrl from "@lobehub/icons-static-svg/icons/openai.svg"
import openRouterIconUrl from "@lobehub/icons-static-svg/icons/openrouter-color.svg"
import {
  Add01Icon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  EyeIcon,
  EyeOffIcon,
  Refresh01Icon,
  Search01Icon,
} from "@tessera/design-system/components/icons"
import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { useMemo, useState } from "react"
import {
  AI_PROVIDER_DEFINITIONS,
  type AiProviderDefinition,
  type AiProviderDraft,
  type AiProviderDrafts,
  type AiProviderId,
  appendAiProviderModel,
  createInitialAiProviderDrafts,
  matchesAiProvider,
} from "../provider-catalog"

const PROVIDER_ICON_URLS: Record<AiProviderId, string> = {
  "openai-compatible": openAiIconUrl,
  "anthropic-compatible": anthropicIconUrl,
  deepseek: deepSeekIconUrl,
  grok: grokIconUrl,
  openrouter: openRouterIconUrl,
}

function ProviderMark({ provider }: { provider: AiProviderDefinition }) {
  const monochrome = provider.id !== "deepseek" && provider.id !== "openrouter"

  return (
    <span
      className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted"
      aria-hidden="true"
    >
      <img
        src={PROVIDER_ICON_URLS[provider.id]}
        alt=""
        className={`size-6 ${monochrome ? "dark:invert" : ""}`}
      />
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

interface ProviderCardProps {
  draft: AiProviderDraft
  onOpen: () => void
  onToggle: (checked: boolean) => void
  provider: AiProviderDefinition
}

function ProviderCard({ draft, onOpen, onToggle, provider }: ProviderCardProps) {
  return (
    <article className="flex min-h-48 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-colors hover:border-input">
      <button type="button" className="flex flex-1 flex-col p-5 text-left" onClick={onOpen}>
        <div className="flex items-start gap-3.5">
          <ProviderMark provider={provider} />
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-medium tracking-[-0.01em]">{provider.name}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{provider.protocol}</p>
          </div>
        </div>
        <p className="mt-5 text-[13px] leading-5 text-muted-foreground">{provider.description}</p>
      </button>
      <footer className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
        <ProviderStatus configured={draft.apiKeyConfigured} />
        <Switch
          checked={draft.enabled}
          onCheckedChange={onToggle}
          aria-label={`${draft.enabled ? "停用" : "启用"}${provider.name}`}
        />
      </footer>
    </article>
  )
}

interface ProviderDirectoryProps {
  drafts: AiProviderDrafts
  onOpenProvider: (providerId: AiProviderId) => void
  onUpdateProvider: (providerId: AiProviderId, update: Partial<AiProviderDraft>) => void
}

function ProviderDirectory({ drafts, onOpenProvider, onUpdateProvider }: ProviderDirectoryProps) {
  const [query, setQuery] = useState("")
  const visibleProviders = useMemo(
    () => AI_PROVIDER_DEFINITIONS.filter((provider) => matchesAiProvider(provider, query)),
    [query],
  )
  const enabledProviders = visibleProviders.filter((provider) => drafts[provider.id].enabled)
  const availableProviders = visibleProviders.filter((provider) => !drafts[provider.id].enabled)

  const renderCards = (providers: readonly AiProviderDefinition[]) => (
    <div className="grid grid-cols-1 gap-4 min-[980px]:grid-cols-2">
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          draft={drafts[provider.id]}
          onOpen={() => onOpenProvider(provider.id)}
          onToggle={(enabled) => onUpdateProvider(provider.id, { enabled })}
        />
      ))}
    </div>
  )

  return (
    <div className="space-y-8">
      <div className="relative max-w-md">
        <Icon
          icon={Search01Icon}
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          className="h-9 pl-9 text-[13px]"
          placeholder="搜索供应商、协议或适配器"
          aria-label="搜索 AI 供应商"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {enabledProviders.length > 0 ? (
        <section className="space-y-3" aria-labelledby="enabled-ai-providers">
          <div className="flex items-baseline gap-2">
            <h2 id="enabled-ai-providers" className="text-[15px] font-medium tracking-[-0.01em]">
              已启用供应商
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">{enabledProviders.length}</span>
          </div>
          {renderCards(enabledProviders)}
        </section>
      ) : null}

      {availableProviders.length > 0 ? (
        <section className="space-y-3" aria-labelledby="available-ai-providers">
          <div className="flex items-baseline gap-2">
            <h2 id="available-ai-providers" className="text-[15px] font-medium tracking-[-0.01em]">
              {enabledProviders.length > 0 ? "其他供应商" : "模型供应商"}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">{availableProviders.length}</span>
          </div>
          {renderCards(availableProviders)}
        </section>
      ) : null}

      {visibleProviders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <p className="text-[13px] font-medium">没有匹配的供应商</p>
          <p className="mt-1 text-[13px] text-muted-foreground">换一个名称、协议或适配器关键词试试。</p>
        </div>
      ) : null}
    </div>
  )
}

interface ProviderDetailProps {
  apiKey: string
  draft: AiProviderDraft
  onApiKeyChange: (apiKey: string) => void
  onBack: () => void
  onUpdate: (update: Partial<AiProviderDraft>) => void
  provider: AiProviderDefinition
}

function ProviderDetail({ apiKey, draft, onApiKeyChange, onBack, onUpdate, provider }: ProviderDetailProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelInput, setModelInput] = useState("")
  const [modelSearch, setModelSearch] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const visibleModels = draft.models.filter((model) =>
    model.id.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()),
  )

  const addModel = () => {
    const models = appendAiProviderModel(draft.models, modelInput)
    if (models.length === draft.models.length) return
    onUpdate({ models })
    setModelInput("")
  }

  const saveSessionDraft = () => {
    onUpdate({ apiKeyConfigured: apiKey.trim().length > 0 })
    setNotice("配置已保留在当前应用会话；安全存储和真实连接将在 API 运行时接入时启用。")
  }

  return (
    <div className="space-y-8">
      <header>
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} size={14} />
          返回供应商
        </Button>
        <div className="mt-5 flex items-start justify-between gap-6 border-b border-border pb-6">
          <div className="flex min-w-0 items-start gap-4">
            <ProviderMark provider={provider} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-xl font-medium tracking-[-0.02em]">{provider.name}</h2>
                <ProviderStatus configured={draft.apiKeyConfigured} />
              </div>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-muted-foreground">
                {provider.description}
              </p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">{provider.adapter}</p>
            </div>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) => onUpdate({ enabled })}
            aria-label={`${draft.enabled ? "停用" : "启用"}${provider.name}`}
          />
        </div>
      </header>

      <div className="rounded-lg border border-border bg-muted/45 px-4 py-3 text-[13px] leading-5 text-muted-foreground">
        当前只配置 API 连接。外部 Agent 与本地模型不在本阶段的连接范围内；API Key 不会写入渲染层持久化存储。
      </div>

      <SettingSection title="连接配置" description={`请求将通过 ${provider.adapter} 适配。`}>
        <SettingRow
          title="API Key"
          description={draft.apiKeyConfigured ? "当前会话已输入密钥。" : "密钥只保留在当前应用会话中。"}
          className="grid-cols-1 gap-4 min-[880px]:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]"
          control={
            <div className="relative w-full min-[880px]:w-[min(38vw,420px)]">
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                className="h-9 pr-10"
                placeholder={provider.apiKeyPlaceholder}
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
            </div>
          }
        />
        <SettingRow
          title="API 地址"
          description="已预填官方默认地址；使用代理、中转或兼容服务时再修改。"
          className="grid-cols-1 gap-4 min-[880px]:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]"
          control={
            <Input
              value={draft.baseUrl}
              className="h-9 w-full min-[880px]:w-[min(38vw,420px)]"
              placeholder={provider.defaultBaseUrl}
              aria-label={`${provider.name} Base URL`}
              spellCheck={false}
              onChange={(event) => onUpdate({ baseUrl: event.currentTarget.value })}
            />
          }
        />
        <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4">
          {notice ? <p className="mr-auto text-xs leading-5 text-muted-foreground">{notice}</p> : null}
          <Button variant="outline" size="sm" disabled title="API 运行时接入后开放">
            测试连接
          </Button>
          <Button size="sm" onClick={saveSessionDraft}>
            保存本次会话
          </Button>
        </div>
      </SettingSection>

      <SettingSection
        title="模型列表"
        description="模型接口由适配器根据 API 地址推导；也可以手动添加模型 ID。"
        action={
          <Button variant="outline" size="sm" disabled title="API 运行时接入后开放">
            <Icon icon={Refresh01Icon} size={13} />
            获取模型
          </Button>
        }
      >
        <div className="flex flex-col gap-2 border-b border-border p-3 min-[760px]:flex-row">
          <div className="relative min-w-0 flex-1">
            <Icon
              icon={Search01Icon}
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={modelSearch}
              className="h-9 pl-9"
              placeholder="搜索已添加模型"
              aria-label="搜索模型"
              onChange={(event) => setModelSearch(event.currentTarget.value)}
            />
          </div>
          <div className="flex min-w-0 gap-2 min-[760px]:w-[45%]">
            <Input
              value={modelInput}
              className="h-9 min-w-0"
              placeholder="输入模型 ID"
              aria-label="模型 ID"
              spellCheck={false}
              onChange={(event) => setModelInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addModel()
              }}
            />
            <Button variant="outline" size="lg" onClick={addModel} disabled={!modelInput.trim()}>
              <Icon icon={Add01Icon} size={14} />
              添加
            </Button>
          </div>
        </div>

        {visibleModels.length > 0 ? (
          <div>
            {visibleModels.map((model) => (
              <div
                key={model.id}
                className="flex min-h-15 items-center gap-4 border-b border-border px-5 py-3 last:border-b-0"
              >
                <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
                  {model.id}
                </code>
                <Switch
                  checked={model.enabled}
                  size="sm"
                  onCheckedChange={(enabled) =>
                    onUpdate({
                      models: draft.models.map((item) =>
                        item.id === model.id ? { ...item, enabled } : item,
                      ),
                    })
                  }
                  aria-label={`${model.enabled ? "停用" : "启用"}模型 ${model.id}`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`删除模型 ${model.id}`}
                  onClick={() => onUpdate({ models: draft.models.filter((item) => item.id !== model.id) })}
                >
                  <Icon icon={Delete02Icon} size={14} />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="text-[13px] font-medium">
              {draft.models.length > 0 ? "没有匹配的模型" : "还没有模型"}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {draft.models.length > 0 ? "换一个模型 ID 关键词试试。" : "输入完整模型 ID 手动添加。"}
            </p>
          </div>
        )}
      </SettingSection>
    </div>
  )
}

export function AiProviderSettings() {
  const [aiEnabled, setAiEnabled] = useState(true)
  const [toolAccessEnabled, setToolAccessEnabled] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<AiProviderId | null>(null)
  const [drafts, setDrafts] = useState(createInitialAiProviderDrafts)
  const [apiKeys, setApiKeys] = useState<Partial<Record<AiProviderId, string>>>({})

  const updateProvider = (providerId: AiProviderId, update: Partial<AiProviderDraft>) => {
    setDrafts((current) => ({
      ...current,
      [providerId]: { ...current[providerId], ...update },
    }))
  }

  const selectedProvider = selectedProviderId
    ? AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === selectedProviderId)
    : undefined

  if (selectedProvider && selectedProviderId) {
    return (
      <ProviderDetail
        provider={selectedProvider}
        draft={drafts[selectedProviderId]}
        apiKey={apiKeys[selectedProviderId] ?? ""}
        onApiKeyChange={(apiKey) => setApiKeys((current) => ({ ...current, [selectedProviderId]: apiKey }))}
        onBack={() => setSelectedProviderId(null)}
        onUpdate={(update) => updateProvider(selectedProviderId, update)}
      />
    )
  }

  return (
    <div className="space-y-10">
      <SettingSection title="可用性" description="控制 Tessera 中的 AI 入口与后续工具能力。">
        <SettingRow
          title="AI 功能"
          description="关闭后隐藏 AI 面板和相关入口，不影响阅读、编辑和保存。"
          control={<Switch checked={aiEnabled} onCheckedChange={setAiEnabled} aria-label="AI 功能" />}
        />
        <SettingRow
          title="允许 AI 提出工具操作"
          description="工具只能提出带明确范围的操作；文件修改仍需经过权限与 Diff。"
          control={
            <Switch
              checked={toolAccessEnabled}
              disabled={!aiEnabled}
              onCheckedChange={setToolAccessEnabled}
              aria-label="允许 AI 提出工具操作"
            />
          }
        />
      </SettingSection>

      <section className="space-y-2" aria-labelledby="api-connection-scope">
        <h2 id="api-connection-scope" className="text-[15px] font-medium tracking-[-0.01em]">
          API 连接
        </h2>
        <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">
          当前阶段只接入远程 API。外部 Agent 与本地模型会作为独立能力建设，因此这里不显示 Connection type。
        </p>
      </section>

      <ProviderDirectory
        drafts={drafts}
        onOpenProvider={setSelectedProviderId}
        onUpdateProvider={updateProvider}
      />
    </div>
  )
}
