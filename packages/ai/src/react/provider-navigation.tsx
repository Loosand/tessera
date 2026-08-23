/**
 * [INPUT]: 供应商连接草稿、当前 configId、连接新增/选择/启停回调与精选品牌图标
 * [OUTPUT]: 供应商目录导航、全部连接总览，以及详情页复用的供应商品牌与配置状态标记
 * [POS]: @tessera/ai/react 供应商设置页的连接导航与总览视图层
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  Add01Icon,
  CheckmarkCircle02Icon,
  ListViewIcon,
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
  useDeferredValue,
  useMemo,
  useState,
} from "react"
import {
  AI_PROVIDER_DEFINITIONS,
  type AiProviderDefinition,
  type AiProviderDraftUpdate,
  type AiProviderDrafts,
  type AiProviderId,
  matchesAiProvider,
} from "../provider-catalog"
import { type ProviderConnectionView, listProviderConnections } from "./provider-settings-state"

type ProviderIconProps = { size?: number }
type LazyProviderIcon = LazyExoticComponent<ComponentType<ProviderIconProps>>

const PROVIDER_ICONS = {
  "openai-compatible": lazy(() => import("@lobehub/icons/es/OpenAI/components/Mono")),
  "anthropic-compatible": lazy(() => import("@lobehub/icons/es/Anthropic/components/Mono")),
  deepseek: lazy(() => import("@lobehub/icons/es/DeepSeek/components/Color")),
  grok: lazy(() => import("@lobehub/icons/es/XAI/components/Mono")),
  openrouter: lazy(() => import("@lobehub/icons/es/OpenRouter/components/Color")),
} satisfies Record<AiProviderId, LazyProviderIcon>

export function ProviderMark({
  provider,
  size = "lg",
}: {
  provider: AiProviderDefinition
  size?: "sm" | "lg"
}) {
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

export function ProviderStatus({ configured }: { configured: boolean }) {
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
  onSelectAll: () => void
  onSelectConfig: (configId: string) => void
  selectedConfigId: string | null
}

export function ProviderDirectory({
  drafts,
  onAddConnection,
  onSelectAll,
  onSelectConfig,
  selectedConfigId,
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
          data-active={draft.configId === selectedConfigId || undefined}
          aria-current={draft.configId === selectedConfigId ? "page" : undefined}
          onClick={() => onSelectConfig(draft.configId)}
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
          data-active={selectedConfigId === null || undefined}
          aria-current={selectedConfigId === null ? "page" : undefined}
          onClick={onSelectAll}
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
  onOpenConfig: (configId: string) => void
  onUpdateProvider: (configId: string, update: AiProviderDraftUpdate) => void
}

export function ProviderOverview({
  drafts,
  error,
  onAddConnection,
  onOpenConfig,
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
          {items.map(({ draft, provider }) => (
            <article
              key={draft.configId}
              className="flex min-h-40 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20"
            >
              <button
                type="button"
                className="min-w-0 flex-1 p-4 text-left"
                onClick={() => onOpenConfig(draft.configId)}
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
          ))}
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
