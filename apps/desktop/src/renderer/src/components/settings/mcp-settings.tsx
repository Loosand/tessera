/**
 * [INPUT]: MCP 服务器 CRUD/检测函数、变更订阅与共享 MCP 契约
 * [OUTPUT]: Cherry Studio/LobeHub 风格的服务器目录、连接详情、信任配置和逐工具开关
 * [POS]: 桌面设置中的 MCP 管理工作区
 * [DOC]: design.md、docs/architecture/mcp.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  McpServerConfig,
  McpServerSaveInput,
  McpServerTestResult,
  McpServerTransport,
  McpToolSummary,
} from "@tessera/contracts"
import {
  Add01Icon,
  Cancel01Icon,
  CommandLineIcon,
  Delete02Icon,
  Plug01Icon,
  Refresh01Icon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  Shield01Icon,
  Wrench01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@tessera/design-system/components/ui/dialog"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { Textarea } from "@tessera/design-system/components/ui/textarea"
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"

type McpSettingsProps = Readonly<{
  deleteServer: (serverId: string) => Promise<void>
  listServers: () => Promise<McpServerConfig[]>
  saveServer: (input: McpServerSaveInput) => Promise<McpServerConfig>
  subscribeToChanges: (listener: () => void) => () => void
  testServer: (serverId: string) => Promise<McpServerTestResult>
}>

type McpServerDraft = {
  argsText: string
  command: string
  description: string
  enabled: boolean
  envText: string
  headersText: string
  id: string
  name: string
  removeEnv: boolean
  removeHeaders: boolean
  timeoutSeconds: string
  transport: McpServerTransport
  trusted: boolean
  url: string
}

const TRANSPORT_LABELS: Record<McpServerTransport, string> = {
  stdio: "本地 stdio",
  "streamable-http": "Streamable HTTP",
  sse: "SSE（兼容）",
}

const STATUS_LABELS: Record<McpServerConfig["status"], string> = {
  disabled: "已停用",
  idle: "待连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接失败",
}

function createDraft(server: McpServerConfig | null): McpServerDraft {
  if (!server) {
    return {
      argsText: "",
      command: "",
      description: "",
      enabled: false,
      envText: "",
      headersText: "",
      id: `mcp-${crypto.randomUUID()}`,
      name: "",
      removeEnv: false,
      removeHeaders: false,
      timeoutSeconds: "30",
      transport: "stdio",
      trusted: false,
      url: "",
    }
  }
  return {
    argsText: server.args.join("\n"),
    command: server.command ?? "",
    description: server.description,
    enabled: server.enabled,
    envText: "",
    headersText: "",
    id: server.id,
    name: server.name,
    removeEnv: false,
    removeHeaders: false,
    timeoutSeconds: String(server.timeoutMs / 1_000),
    transport: server.transport,
    trusted: server.trusted,
    url: server.url ?? "",
  }
}

function parseKeyValueLines(value: string, label: string) {
  if (!value.trim()) return undefined
  const result: Record<string, string> = {}
  for (const [index, line] of value.split("\n").entries()) {
    if (!line.trim()) continue
    const separator = line.indexOf("=")
    if (separator <= 0) throw new Error(`${label}第 ${index + 1} 行应为 NAME=value。`)
    const key = line.slice(0, separator).trim()
    if (!key) throw new Error(`${label}第 ${index + 1} 行缺少名称。`)
    result[key] = line.slice(separator + 1)
  }
  return result
}

function inputFromServer(server: McpServerConfig, update: Partial<McpServerSaveInput> = {}) {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    timeoutMs: server.timeoutMs,
    trusted: server.trusted,
    enabled: server.enabled,
    disabledTools: server.disabledTools,
    ...update,
  } satisfies McpServerSaveInput
}

function ServerMark({ transport }: { transport: McpServerTransport }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground"
      aria-hidden="true"
    >
      <Icon icon={transport === "stdio" ? CommandLineIcon : ServerStack01Icon} size={18} />
    </span>
  )
}

function StatusDot({ status }: { status: McpServerConfig["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={`size-1.5 rounded-full ${
          status === "connected"
            ? "bg-emerald-500"
            : status === "connecting"
              ? "animate-pulse bg-amber-500"
              : status === "error"
                ? "bg-destructive"
                : "bg-input"
        }`}
        aria-hidden="true"
      />
      {STATUS_LABELS[status]}
    </span>
  )
}

function Field({
  children,
  description,
  label,
}: {
  children: React.ReactNode
  description?: string
  label: string
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-medium">{label}</span>
      {children}
      {description ? (
        <span className="text-[10px] leading-4 text-muted-foreground">{description}</span>
      ) : null}
    </div>
  )
}

type ServerEditorDialogProps = Readonly<{
  onOpenChange: (open: boolean) => void
  onSave: (input: McpServerSaveInput) => Promise<void>
  open: boolean
  server: McpServerConfig | null
}>

function ServerEditorDialog({ onOpenChange, onSave, open, server }: ServerEditorDialogProps) {
  const [draft, setDraft] = useState(() => createDraft(server))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(createDraft(server))
    setError(null)
  }, [open, server])

  const update = <Key extends keyof McpServerDraft>(key: Key, value: McpServerDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const timeoutSeconds = Number(draft.timeoutSeconds)
      if (!Number.isFinite(timeoutSeconds)) throw new Error("连接超时应为数字。")
      const env = draft.removeEnv ? undefined : parseKeyValueLines(draft.envText, "环境变量")
      const headers = draft.removeHeaders ? undefined : parseKeyValueLines(draft.headersText, "请求头")
      await onSave({
        id: draft.id,
        name: draft.name,
        description: draft.description,
        transport: draft.transport,
        command: draft.transport === "stdio" ? draft.command : null,
        args:
          draft.transport === "stdio"
            ? draft.argsText
                .split("\n")
                .map((argument) => argument.trim())
                .filter(Boolean)
            : [],
        url: draft.transport === "stdio" ? null : draft.url,
        timeoutMs: Math.round(timeoutSeconds * 1_000),
        trusted: draft.trusted,
        enabled: draft.enabled,
        disabledTools: server?.disabledTools ?? [],
        ...(env ? { env } : {}),
        ...(headers ? { headers } : {}),
        ...(draft.removeEnv ? { removeEnv: true } : {}),
        ...(draft.removeHeaders ? { removeHeaders: true } : {}),
      })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存 MCP 服务器失败。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[78vh] max-w-2xl overflow-hidden p-0" initialFocus={false}>
        <header className="relative border-b border-border px-6 py-5 pr-14">
          <DialogTitle>{server ? "编辑 MCP 服务器" : "添加 MCP 服务器"}</DialogTitle>
          <DialogDescription>本地命令由主进程启动；环境变量与请求头使用系统安全存储加密。</DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-4 right-4 text-muted-foreground"
            aria-label="关闭 MCP 服务器设置"
            onClick={() => onOpenChange(false)}
          >
            <Icon icon={Cancel01Icon} size={14} />
          </Button>
        </header>

        <div className="max-h-[calc(78vh-150px)] space-y-6 overflow-y-auto px-6 py-5">
          {error ? (
            <p
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="显示名称">
              <Input
                aria-label="显示名称"
                value={draft.name}
                placeholder="例如 Filesystem"
                onChange={(event) => update("name", event.currentTarget.value)}
              />
            </Field>
            <Field
              label="服务器 ID"
              description={server ? "创建后不可修改。" : "仅在 Tessera 内部标识这个连接。"}
            >
              <Input
                aria-label="服务器 ID"
                value={draft.id}
                disabled={Boolean(server)}
                onChange={(event) => update("id", event.currentTarget.value)}
              />
            </Field>
            <Field label="传输方式">
              <NativeSelect
                aria-label="传输方式"
                className="w-full"
                containerClassName="w-full"
                value={draft.transport}
                onChange={(event) => update("transport", event.currentTarget.value as McpServerTransport)}
              >
                <option value="stdio">本地 stdio</option>
                <option value="streamable-http">Streamable HTTP</option>
                <option value="sse">SSE（旧服务兼容）</option>
              </NativeSelect>
            </Field>
            <Field label="连接超时（秒）">
              <Input
                aria-label="连接超时（秒）"
                type="number"
                min={1}
                max={180}
                value={draft.timeoutSeconds}
                onChange={(event) => update("timeoutSeconds", event.currentTarget.value)}
              />
            </Field>
            <div className="grid gap-1.5 sm:col-span-2">
              <span className="text-[12px] font-medium">说明</span>
              <Textarea
                aria-label="说明"
                className="min-h-16"
                value={draft.description}
                placeholder="这个服务器提供什么能力？"
                onChange={(event) => update("description", event.currentTarget.value)}
              />
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-border p-4">
            <div>
              <h3 className="text-[13px] font-medium">连接配置</h3>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {draft.transport === "stdio"
                  ? "命令和参数不会交给渲染层执行；参数每行一项，不经过 Shell 展开。"
                  : "远程地址仅允许 HTTP(S)，账号密码请放在加密请求头中。"}
              </p>
            </div>
            {draft.transport === "stdio" ? (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <Field label="启动命令">
                  <Input
                    aria-label="启动命令"
                    className="font-mono text-xs"
                    value={draft.command}
                    placeholder="npx"
                    onChange={(event) => update("command", event.currentTarget.value)}
                  />
                </Field>
                <Field label="启动参数" description="每行一个参数。">
                  <Textarea
                    aria-label="启动参数"
                    className="min-h-24 font-mono text-xs"
                    value={draft.argsText}
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/workspace"}
                    onChange={(event) => update("argsText", event.currentTarget.value)}
                  />
                </Field>
              </div>
            ) : (
              <Field label="服务器地址">
                <Input
                  aria-label="服务器地址"
                  className="font-mono text-xs"
                  type="url"
                  value={draft.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => update("url", event.currentTarget.value)}
                />
              </Field>
            )}
          </section>

          <section className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h3 className="text-[13px] font-medium">加密变量</h3>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                每行使用 NAME=value。编辑已有服务器时留空会保留已保存值，界面不会回显秘密。
              </p>
            </div>
            <Field label="环境变量">
              <Textarea
                aria-label="环境变量"
                className="min-h-24 font-mono text-xs"
                disabled={draft.removeEnv}
                value={draft.envText}
                placeholder={server?.envConfigured ? "已安全保存；留空保持不变" : "API_KEY=..."}
                onChange={(event) => update("envText", event.currentTarget.value)}
              />
              {server?.envConfigured ? (
                <button
                  type="button"
                  className="w-fit text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => update("removeEnv", !draft.removeEnv)}
                >
                  {draft.removeEnv ? "撤销移除" : "移除已保存环境变量"}
                </button>
              ) : null}
            </Field>
            <Field label="请求头">
              <Textarea
                aria-label="请求头"
                className="min-h-24 font-mono text-xs"
                disabled={draft.removeHeaders}
                value={draft.headersText}
                placeholder={
                  server?.headersConfigured ? "已安全保存；留空保持不变" : "Authorization=Bearer ..."
                }
                onChange={(event) => update("headersText", event.currentTarget.value)}
              />
              {server?.headersConfigured ? (
                <button
                  type="button"
                  className="w-fit text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => update("removeHeaders", !draft.removeHeaders)}
                >
                  {draft.removeHeaders ? "撤销移除" : "移除已保存请求头"}
                </button>
              ) : null}
            </Field>
          </section>

          <section className="space-y-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
            <div className="flex gap-3">
              <span className="mt-0.5 text-amber-700 dark:text-amber-300" aria-hidden="true">
                <Icon icon={Shield01Icon} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-medium">信任边界</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  MCP
                  服务器是外部程序，可能访问网络或本机数据。只有确认来源与配置后才应信任；工具真正执行前仍会逐次请求批准。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-amber-500/20 pt-3">
              <div>
                <p className="text-[12px] font-medium">我信任这个服务器</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">未信任时不能连接或启用。</p>
              </div>
              <Switch checked={draft.trusted} onCheckedChange={(trusted) => update("trusted", trusted)} />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-amber-500/20 pt-3">
              <div>
                <p className="text-[12px] font-medium">保存后启用</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">启用后工具会进入 Agent 可选能力。</p>
              </div>
              <Switch
                checked={draft.enabled}
                disabled={!draft.trusted}
                onCheckedChange={(enabled) => update("enabled", enabled)}
              />
            </div>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void submit()}>
            {saving ? "保存中…" : "保存服务器"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function ToolAnnotations({ tool }: { tool: McpToolSummary }) {
  const labels = [
    tool.annotations?.readOnly ? "只读" : null,
    tool.annotations?.destructive ? "可能修改数据" : null,
    tool.annotations?.openWorld ? "外部交互" : null,
  ].filter(Boolean)
  if (labels.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <span key={label} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
          {label}
        </span>
      ))}
    </span>
  )
}

type ServerDetailProps = Readonly<{
  busy: string | null
  onDelete: (server: McpServerConfig) => Promise<void>
  onEdit: (server: McpServerConfig) => void
  onTest: (server: McpServerConfig) => Promise<void>
  onToggleServer: (server: McpServerConfig, enabled: boolean) => Promise<void>
  onToggleTool: (server: McpServerConfig, tool: McpToolSummary, enabled: boolean) => Promise<void>
  server: McpServerConfig
  tools: McpToolSummary[] | undefined
}>

function ServerDetail({
  busy,
  onDelete,
  onEdit,
  onTest,
  onToggleServer,
  onToggleTool,
  server,
  tools,
}: ServerDetailProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <section className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-4xl px-[clamp(24px,5vw,56px)] py-8 pb-24">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="flex min-w-0 items-start gap-3">
            <ServerMark transport={server.transport} />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-medium tracking-[-0.02em]">{server.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <code className="font-mono text-[10px] text-muted-foreground">{server.id}</code>
                <StatusDot status={server.status} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void onTest(server)}>
              <Icon
                icon={Refresh01Icon}
                size={14}
                className={busy === `test:${server.id}` ? "animate-spin" : undefined}
              />
              检测连接
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="编辑 MCP 服务器"
              onClick={() => onEdit(server)}
            >
              <Icon icon={Settings01Icon} size={14} />
            </Button>
            <Switch
              size="sm"
              checked={server.enabled}
              disabled={Boolean(busy)}
              onCheckedChange={(enabled) => void onToggleServer(server, enabled)}
              aria-label={`${server.enabled ? "停用" : "启用"}${server.name}`}
            />
          </div>
        </header>

        {server.lastError ? (
          <p
            className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive"
            role="alert"
          >
            {server.lastError}
          </p>
        ) : null}

        <section className="mt-7 grid gap-3 sm:grid-cols-2">
          <article className="rounded-xl border border-border p-4">
            <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">连接</p>
            <p className="mt-2 text-[13px] font-medium">{TRANSPORT_LABELS[server.transport]}</p>
            <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
              {server.transport === "stdio"
                ? [server.command, ...server.args].filter(Boolean).join(" ")
                : server.url}
            </code>
            <p className="mt-3 text-[10px] text-muted-foreground">超时 {server.timeoutMs / 1_000} 秒</p>
          </article>
          <article className="rounded-xl border border-border p-4">
            <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              服务器身份
            </p>
            <p className="mt-2 text-[13px] font-medium">{server.serverName ?? "尚未发现"}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {server.serverVersion ? `版本 ${server.serverVersion}` : "连接检测后读取 MCP 握手信息"}
            </p>
            <p className="mt-3 flex gap-2 text-[10px] text-muted-foreground">
              <span>{server.envConfigured ? "环境变量已加密" : "无环境变量"}</span>
              <span>·</span>
              <span>{server.headersConfigured ? "请求头已加密" : "无请求头"}</span>
            </p>
          </article>
        </section>

        {server.description ? (
          <p className="mt-5 text-[12px] leading-5 text-muted-foreground">{server.description}</p>
        ) : null}

        <section className="mt-8 overflow-hidden rounded-xl border border-border">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
            <div>
              <h2 className="text-[13px] font-medium">工具</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                已启用工具会提供给 Agent；每次真正执行前都会请求人工批准。
              </p>
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">{tools?.length ?? "—"}</span>
          </header>
          {tools ? (
            tools.length > 0 ? (
              <div>
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                      aria-hidden="true"
                    >
                      <Icon icon={Wrench01Icon} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-mono text-[11px] font-medium">
                          {tool.title ?? tool.name}
                        </p>
                        <ToolAnnotations tool={tool} />
                      </div>
                      {tool.description ? (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                          {tool.description}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      size="sm"
                      checked={tool.enabled}
                      disabled={Boolean(busy)}
                      onCheckedChange={(enabled) => void onToggleTool(server, tool, enabled)}
                      aria-label={`${tool.enabled ? "停用" : "启用"}工具 ${tool.name}`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-10 text-center">
                <p className="text-[12px] font-medium">服务器没有公开工具</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  未来版本会继续承载 Resources 与 Prompts。
                </p>
              </div>
            )
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-[12px] font-medium">尚未读取工具列表</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                确认信任后点击“检测连接”完成握手和工具发现。
              </p>
            </div>
          )}
        </section>

        <section className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-destructive/15 p-4">
          <div>
            <p className="text-[12px] font-medium">删除服务器</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              会关闭活动连接并删除加密配置，不会卸载外部程序。
            </p>
          </div>
          <Button
            variant={confirmDelete ? "destructive" : "outline"}
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => (confirmDelete ? void onDelete(server) : setConfirmDelete(true))}
          >
            <Icon icon={Delete02Icon} size={14} />
            {confirmDelete ? "确认删除" : "删除"}
          </Button>
        </section>
      </div>
    </section>
  )
}

export function McpSettings({
  deleteServer,
  listServers,
  saveServer,
  subscribeToChanges,
  testServer,
}: McpSettingsProps) {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editorServer, setEditorServer] = useState<McpServerConfig | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolSummary[]>>({})
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"))

  const refresh = useCallback(async () => {
    try {
      const next = await listServers()
      setServers(next)
      setSelectedId((current) =>
        current && next.some((server) => server.id === current) ? current : (next[0]?.id ?? null),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 MCP 服务器失败。")
    }
  }, [listServers])

  useEffect(() => {
    void refresh()
    return subscribeToChanges(() => void refresh())
  }, [refresh, subscribeToChanges])

  const visibleServers = useMemo(
    () =>
      servers.filter((server) =>
        `${server.name} ${server.id} ${server.description} ${server.transport}`
          .toLocaleLowerCase("zh-CN")
          .includes(deferredQuery),
      ),
    [deferredQuery, servers],
  )
  const selected = servers.find((server) => server.id === selectedId) ?? null

  const persist = async (input: McpServerSaveInput) => {
    const saved = await saveServer(input)
    setServers((current) => {
      const exists = current.some((server) => server.id === saved.id)
      return exists ? current.map((server) => (server.id === saved.id ? saved : server)) : [...current, saved]
    })
    setSelectedId(saved.id)
  }

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP 操作失败。")
    } finally {
      setBusy(null)
    }
  }

  const handleTest = (server: McpServerConfig) =>
    run(`test:${server.id}`, async () => {
      const result = await testServer(server.id)
      if (!result.ok) throw new Error(result.error)
      setServers((current) =>
        current.map((candidate) => (candidate.id === server.id ? result.server : candidate)),
      )
      setToolsByServer((current) => ({ ...current, [server.id]: result.tools }))
    })

  const handleToggleServer = (server: McpServerConfig, enabled: boolean) => {
    if (enabled && !server.trusted) {
      setEditorServer(server)
      setEditorOpen(true)
      setError("启用前请在服务器设置中确认信任。")
      return Promise.resolve()
    }
    return run(`server:${server.id}`, () => persist(inputFromServer(server, { enabled })))
  }

  const handleToggleTool = (server: McpServerConfig, tool: McpToolSummary, enabled: boolean) =>
    run(`tool:${server.id}:${tool.name}`, async () => {
      const disabledTools = enabled
        ? server.disabledTools.filter((name) => name !== tool.name)
        : [...new Set([...server.disabledTools, tool.name])]
      await persist(inputFromServer(server, { disabledTools }))
      setToolsByServer((current) => ({
        ...current,
        [server.id]: (current[server.id] ?? []).map((candidate) =>
          candidate.name === tool.name ? { ...candidate, enabled } : candidate,
        ),
      }))
    })

  const handleDelete = (server: McpServerConfig) =>
    run(`delete:${server.id}`, async () => {
      await deleteServer(server.id)
      setToolsByServer((current) => {
        const next = { ...current }
        delete next[server.id]
        return next
      })
      await refresh()
    })

  return (
    <div className="grid h-full min-h-0 grid-cols-1 min-[860px]:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-border bg-sidebar min-[860px]:border-r min-[860px]:border-b-0">
        <header className="shrink-0 border-b border-border px-3 pt-4 pb-3">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <div>
              <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                设置
              </p>
              <h1 className="mt-1 text-[15px] font-medium">MCP 服务器</h1>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{servers.length}</span>
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
              placeholder="搜索服务器"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
        </header>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="MCP 服务器">
          <div className="space-y-0.5">
            {visibleServers.map((server) => (
              <button
                key={server.id}
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent data-[active=true]:bg-accent"
                data-active={server.id === selectedId || undefined}
                onClick={() => setSelectedId(server.id)}
              >
                <ServerMark transport={server.transport} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{server.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                    {TRANSPORT_LABELS[server.transport]}
                  </span>
                </span>
                <span
                  className={`size-1.5 shrink-0 rounded-full ${server.status === "connected" ? "bg-emerald-500" : server.status === "error" ? "bg-destructive" : "bg-input"}`}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
          {visibleServers.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] text-muted-foreground">
              {servers.length === 0 ? "还没有 MCP 服务器。" : "没有匹配的服务器。"}
            </p>
          ) : null}
        </nav>
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setEditorServer(null)
              setEditorOpen(true)
            }}
          >
            <Icon icon={Add01Icon} size={14} />
            添加服务器
          </Button>
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto">
        {error ? (
          <div
            className="sticky top-0 z-10 border-b border-destructive/20 bg-destructive/8 px-5 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {selected ? (
          <ServerDetail
            key={selected.id}
            server={selected}
            tools={toolsByServer[selected.id]}
            busy={busy}
            onEdit={(server) => {
              setEditorServer(server)
              setEditorOpen(true)
            }}
            onTest={handleTest}
            onToggleServer={handleToggleServer}
            onToggleTool={handleToggleTool}
            onDelete={handleDelete}
          />
        ) : (
          <div className="flex min-h-full items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <span
                className="mx-auto flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <Icon icon={Plug01Icon} size={22} />
              </span>
              <h2 className="mt-4 text-[15px] font-medium">连接外部工具服务器</h2>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                支持本地 stdio、Streamable HTTP 与旧版 SSE。服务器启用后，工具会进入 Agent 的逐次审批链路。
              </p>
              <Button
                className="mt-5"
                size="sm"
                onClick={() => {
                  setEditorServer(null)
                  setEditorOpen(true)
                }}
              >
                <Icon icon={Add01Icon} size={14} />
                添加 MCP 服务器
              </Button>
            </div>
          </div>
        )}
      </main>

      <ServerEditorDialog
        open={editorOpen}
        server={editorServer}
        onOpenChange={setEditorOpen}
        onSave={async (input) => {
          setError(null)
          await persist(input)
        }}
      />
    </div>
  )
}
