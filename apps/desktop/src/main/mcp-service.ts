/**
 * [INPUT]: SQLite MCP 配置仓储、Electron safeStorage、MCP SDK 传输和 Agent 中止/审批上下文
 * [OUTPUT]: 加密配置 CRUD、stdio/HTTP/SSE 连接池、工具发现和强制审批 Agent 工具适配
 * [POS]: Electron 主进程持有的 MCP 信任、连接与执行安全边界
 * [DOC]: docs/architecture/mcp.md、docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash } from "node:crypto"
import type { ExternalAgentTool } from "@tessera/ai/server"
import type { McpServerConfig, McpServerSaveInput, McpToolSummary } from "@tessera/contracts"
import {
  type DatabaseClient,
  type McpServerConfigRecord,
  deleteMcpServerConfigRecord,
  findMcpServerConfigRecord,
  listMcpServerConfigRecords,
  upsertMcpServerConfigRecord,
} from "@tessera/database"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { app } from "electron"

const MAX_ARGUMENTS = 64
const MAX_SECRET_ENTRIES = 64
const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024
const MAX_TOOL_PAGES = 20
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 180_000

export class McpConfigError extends Error {}

type SecretStorage = Readonly<{
  decrypt: (value: string) => string
  encrypt: (value: string) => string
  isEncryptionAvailable: () => boolean
}>

type ResolvedMcpServer = Readonly<{
  args: string[]
  command: string | null
  disabledTools: string[]
  enabled: boolean
  env: Record<string, string>
  headers: Record<string, string>
  id: string
  name: string
  timeoutMs: number
  transport: McpServerConfig["transport"]
  trusted: boolean
  url: string | null
}>

type McpClientAdapter = Readonly<{
  callTool: (name: string, input: unknown, signal: AbortSignal) => Promise<unknown>
  close: () => Promise<void>
  listTools: () => Promise<McpToolSummary[]>
  serverName?: string
  serverVersion?: string
}>

type CreateMcpClient = (server: ResolvedMcpServer) => Promise<McpClientAdapter>

type McpServiceOptions = Readonly<{
  client: DatabaseClient
  createClient?: CreateMcpClient
  onChanged?: () => void
  secretStorage: SecretStorage
}>

export type McpService = Readonly<{
  close: () => Promise<void>
  createAgentTools: (signal: AbortSignal) => Promise<ExternalAgentTool[]>
  deleteServer: (serverId: string) => Promise<void>
  listServers: () => McpServerConfig[]
  saveServer: (input: McpServerSaveInput) => Promise<McpServerConfig>
  testServer: (serverId: string) => Promise<{ server: McpServerConfig; tools: McpToolSummary[] }>
}>

function parseStringArray(value: string, field: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error()
    return parsed
  } catch {
    throw new McpConfigError(`${field}配置已损坏，请删除后重新添加这个 MCP 服务器。`)
  }
}

function parseSecretMap(value: string, field: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Object.entries(parsed).every(([key, item]) => key && typeof item === "string")
    ) {
      throw new Error()
    }
    return parsed as Record<string, string>
  } catch {
    throw new McpConfigError(`${field}无法解密或格式已损坏，请重新保存。`)
  }
}

function normalizeSecretMap(value: Record<string, string> | undefined, field: string) {
  if (!value) return undefined
  const entries = Object.entries(value)
  if (entries.length > MAX_SECRET_ENTRIES) throw new McpConfigError(`${field}最多允许 64 项。`)
  const normalized: Record<string, string> = {}
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim()
    if (!key || key.length > 128 || /[\r\n]/u.test(key)) {
      throw new McpConfigError(`${field}名称无效。`)
    }
    if (rawValue.length > 8_192 || /[\0]/u.test(rawValue)) {
      throw new McpConfigError(`${field}值过长或包含无效字符。`)
    }
    normalized[key] = rawValue
  }
  return normalized
}

function normalizeUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new McpConfigError("MCP 地址无效。")
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new McpConfigError("MCP 地址只允许不含账号密码的 HTTP(S) URL。")
  }
  return url.toString()
}

function normalizeInput(input: McpServerSaveInput): McpServerSaveInput {
  const id = input.id.trim()
  const name = input.name.trim()
  const description = input.description.trim()
  const command = input.command?.trim() || null
  const url = normalizeUrl(input.url)
  const timeoutMs = Math.round(input.timeoutMs)
  const args = input.args.map((argument) => argument.trim()).filter(Boolean)
  const disabledTools = [...new Set(input.disabledTools.map((toolName) => toolName.trim()).filter(Boolean))]

  if (!(["stdio", "streamable-http", "sse"] as const).includes(input.transport)) {
    throw new McpConfigError("MCP 传输类型无效。")
  }
  if (!/^[a-z\d][a-z\d_-]{0,127}$/iu.test(id)) throw new McpConfigError("MCP 服务器 ID 无效。")
  if (!name || name.length > 80) throw new McpConfigError("MCP 服务器名称应为 1–80 个字符。")
  if (description.length > 500) throw new McpConfigError("MCP 服务器说明不能超过 500 个字符。")
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new McpConfigError("连接超时必须在 1–180 秒之间。")
  }
  if (args.length > MAX_ARGUMENTS || args.some((argument) => argument.length > 2_000)) {
    throw new McpConfigError("启动参数数量或长度超过限制。")
  }
  if (disabledTools.some((toolName) => toolName.length > 256)) {
    throw new McpConfigError("禁用工具名称无效。")
  }
  if (input.transport === "stdio" && !command) throw new McpConfigError("stdio 服务器必须填写启动命令。")
  if (input.transport !== "stdio" && !url) throw new McpConfigError("远程 MCP 服务器必须填写地址。")
  if (input.enabled && !input.trusted) throw new McpConfigError("启用 MCP 服务器前必须确认信任。")

  return {
    ...input,
    id,
    name,
    description,
    command: input.transport === "stdio" ? command : null,
    url: input.transport === "stdio" ? null : url,
    args: input.transport === "stdio" ? args : [],
    disabledTools,
    timeoutMs,
    ...(input.env === undefined ? {} : { env: normalizeSecretMap(input.env, "环境变量") ?? {} }),
    ...(input.headers === undefined ? {} : { headers: normalizeSecretMap(input.headers, "请求头") ?? {} }),
  }
}

function serverFingerprint(record: McpServerConfigRecord) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        transport: record.transport,
        command: record.command,
        argsJson: record.argsJson,
        url: record.url,
        timeoutMs: record.timeoutMs,
        envCiphertext: record.envCiphertext,
        headersCiphertext: record.headersCiphertext,
      }),
    )
    .digest("hex")
}

function publicServer(
  record: McpServerConfigRecord,
  runtime?: { error?: string; serverName?: string; serverVersion?: string; state: McpServerConfig["status"] },
): McpServerConfig {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    transport: record.transport,
    enabled: record.enabled,
    trusted: record.trusted,
    command: record.command,
    args: parseStringArray(record.argsJson, "启动参数"),
    url: record.url,
    timeoutMs: record.timeoutMs,
    envConfigured: Boolean(record.envCiphertext),
    headersConfigured: Boolean(record.headersCiphertext),
    disabledTools: parseStringArray(record.disabledToolsJson, "禁用工具"),
    updatedAt: record.updatedAt.getTime(),
    status: record.enabled ? (runtime?.state ?? "idle") : "disabled",
    ...(runtime?.error ? { lastError: runtime.error } : {}),
    ...(runtime?.serverName ? { serverName: runtime.serverName } : {}),
    ...(runtime?.serverVersion ? { serverVersion: runtime.serverVersion } : {}),
  }
}

function mergeHeaders(base: HeadersInit | undefined, added: Record<string, string>) {
  const headers = new Headers(base)
  for (const [name, value] of Object.entries(added)) headers.set(name, value)
  return headers
}

function fetchWithHeaders(headers: Record<string, string>) {
  return (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, { ...init, headers: mergeHeaders(init?.headers, headers) })
}

async function createSdkMcpClient(server: ResolvedMcpServer): Promise<McpClientAdapter> {
  const client = new Client({ name: "Tessera", version: app.getVersion() }, { capabilities: {} })
  const transport =
    server.transport === "stdio"
      ? new StdioClientTransport({
          command: server.command ?? "",
          args: server.args,
          env: { ...getDefaultEnvironment(), ...server.env },
          stderr: "pipe",
        })
      : server.transport === "sse"
        ? new SSEClientTransport(new URL(server.url ?? ""), {
            fetch: fetchWithHeaders(server.headers),
            requestInit: { headers: server.headers },
          })
        : new StreamableHTTPClientTransport(new URL(server.url ?? ""), {
            requestInit: { headers: server.headers },
          })

  try {
    await client.connect(transport as unknown as Transport, { timeout: server.timeoutMs })
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }

  const version = client.getServerVersion()
  return {
    ...(version?.name ? { serverName: version.name } : {}),
    ...(version?.version ? { serverVersion: version.version } : {}),
    close: () => client.close(),
    listTools: async () => {
      const tools: McpToolSummary[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
        const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: server.timeoutMs })
        tools.push(
          ...result.tools.map((tool) => ({
            serverId: server.id,
            name: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
            enabled: !server.disabledTools.includes(tool.name),
            ...(tool.annotations
              ? {
                  annotations: {
                    ...(tool.annotations.readOnlyHint !== undefined
                      ? { readOnly: tool.annotations.readOnlyHint }
                      : {}),
                    ...(tool.annotations.destructiveHint !== undefined
                      ? { destructive: tool.annotations.destructiveHint }
                      : {}),
                    ...(tool.annotations.idempotentHint !== undefined
                      ? { idempotent: tool.annotations.idempotentHint }
                      : {}),
                    ...(tool.annotations.openWorldHint !== undefined
                      ? { openWorld: tool.annotations.openWorldHint }
                      : {}),
                  },
                }
              : {}),
          })),
        )
        cursor = result.nextCursor
        if (!cursor) break
      }
      if (cursor) throw new Error("MCP 工具列表超过 20 页安全上限。")
      return tools
    },
    callTool: async (name, input, signal) => {
      const result = await client.callTool(
        { name, arguments: input && typeof input === "object" ? (input as Record<string, unknown>) : {} },
        undefined,
        { signal, timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs },
      )
      if (result.isError) {
        const content = Array.isArray(result.content) ? result.content : []
        const message = content
          .filter((part): part is { text: string; type: "text" } =>
            Boolean(
              part &&
                typeof part === "object" &&
                "type" in part &&
                part.type === "text" &&
                "text" in part &&
                typeof part.text === "string",
            ),
          )
          .map((part) => part.text)
          .join("\n")
        throw new Error(message || "MCP 工具执行失败。")
      }
      const serialized = JSON.stringify(result)
      if (Buffer.byteLength(serialized, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
        throw new Error("MCP 工具输出超过 1 MiB 安全上限。")
      }
      return result
    },
  }
}

function mcpToolId(serverId: string, toolName: string) {
  const serverHash = createHash("sha256").update(serverId).digest("hex").slice(0, 10)
  const toolHash = createHash("sha256").update(toolName).digest("hex").slice(0, 6)
  const safeName =
    toolName
      .replace(/[^a-z\d_-]+/giu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 48) || "tool"
  return `mcp__${serverHash}__${safeName}__${toolHash}`
}

export function createMcpService({
  client,
  createClient = createSdkMcpClient,
  onChanged,
  secretStorage,
}: McpServiceOptions): McpService {
  const connections = new Map<string, { client: McpClientAdapter; fingerprint: string }>()
  const pendingConnections = new Map<string, Promise<McpClientAdapter>>()
  const runtime = new Map<
    string,
    { error?: string; serverName?: string; serverVersion?: string; state: McpServerConfig["status"] }
  >()
  let closed = false

  const notify = () => onChanged?.()
  const setRuntime = (
    serverId: string,
    value: { error?: string; serverName?: string; serverVersion?: string; state: McpServerConfig["status"] },
  ) => {
    runtime.set(serverId, value)
    notify()
  }

  const closeConnection = async (serverId: string) => {
    const pending = pendingConnections.get(serverId)
    if (pending) await pending.catch(() => undefined)
    const connection = connections.get(serverId)
    connections.delete(serverId)
    if (connection) await connection.client.close().catch(() => undefined)
  }

  const resolveRecord = (record: McpServerConfigRecord): ResolvedMcpServer => {
    const decrypt = (ciphertext: string | null, field: string) =>
      ciphertext ? parseSecretMap(secretStorage.decrypt(ciphertext), field) : {}
    return {
      id: record.id,
      name: record.name,
      transport: record.transport,
      enabled: record.enabled,
      trusted: record.trusted,
      command: record.command,
      args: parseStringArray(record.argsJson, "启动参数"),
      url: record.url,
      timeoutMs: record.timeoutMs,
      env: decrypt(record.envCiphertext, "环境变量"),
      headers: decrypt(record.headersCiphertext, "请求头"),
      disabledTools: parseStringArray(record.disabledToolsJson, "禁用工具"),
    }
  }

  const redactError = (error: unknown, server: ResolvedMcpServer) => {
    let message = error instanceof Error ? error.message : "连接失败"
    const secretValues = [...Object.values(server.env), ...Object.values(server.headers)]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
    for (const secret of secretValues) message = message.replaceAll(secret, "[已隐藏]")
    return message
  }

  const redactOutput = (output: unknown, server: ResolvedMcpServer) => {
    let serialized = JSON.stringify(output)
    if (serialized === undefined) return null
    const secretValues = [...Object.values(server.env), ...Object.values(server.headers)]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
    for (const secret of secretValues) {
      const escapedSecret = JSON.stringify(secret).slice(1, -1)
      serialized = serialized.replaceAll(escapedSecret, "[已隐藏]")
    }
    return JSON.parse(serialized) as unknown
  }

  const requireRecord = (serverId: string) => {
    const record = findMcpServerConfigRecord(client, serverId)
    if (!record) throw new McpConfigError("找不到这个 MCP 服务器。")
    return record
  }

  const getClient = async (record: McpServerConfigRecord) => {
    if (closed) throw new McpConfigError("MCP 服务已经关闭。")
    if (!record.trusted) throw new McpConfigError("连接 MCP 服务器前必须确认信任。")
    const fingerprint = serverFingerprint(record)
    const current = connections.get(record.id)
    if (current?.fingerprint === fingerprint) return current.client
    if (current) await closeConnection(record.id)
    const pending = pendingConnections.get(record.id)
    if (pending) return pending

    setRuntime(record.id, { state: "connecting" })
    const resolved = resolveRecord(record)
    const connecting = createClient(resolved)
      .then((mcpClient) => {
        connections.set(record.id, { client: mcpClient, fingerprint })
        setRuntime(record.id, {
          state: "connected",
          ...(mcpClient.serverName ? { serverName: mcpClient.serverName } : {}),
          ...(mcpClient.serverVersion ? { serverVersion: mcpClient.serverVersion } : {}),
        })
        return mcpClient
      })
      .catch((error) => {
        const message = redactError(error, resolved)
        setRuntime(record.id, { state: "error", error: message.slice(0, 500) })
        throw new McpConfigError(`无法连接 MCP 服务器：${message.slice(0, 300)}`)
      })
      .finally(() => pendingConnections.delete(record.id))
    pendingConnections.set(record.id, connecting)
    return connecting
  }

  const listToolsForRecord = async (record: McpServerConfigRecord) => {
    const mcpClient = await getClient(record)
    const disabledTools = new Set(parseStringArray(record.disabledToolsJson, "禁用工具"))
    return (await mcpClient.listTools()).map((tool) => ({
      ...tool,
      serverId: record.id,
      enabled: !disabledTools.has(tool.name),
    }))
  }

  return {
    listServers: () =>
      listMcpServerConfigRecords(client).map((record) => publicServer(record, runtime.get(record.id))),
    saveServer: async (rawInput) => {
      const input = normalizeInput(rawInput)
      const existing = findMcpServerConfigRecord(client, input.id)
      const hasNewSecrets = input.env !== undefined || input.headers !== undefined
      if (hasNewSecrets && !secretStorage.isEncryptionAvailable()) {
        throw new McpConfigError("系统安全存储不可用，不能保存 MCP 环境变量或请求头。")
      }
      const encryptMap = (value: Record<string, string> | undefined) =>
        value === undefined ? undefined : secretStorage.encrypt(JSON.stringify(value))
      const envCiphertext = input.removeEnv
        ? null
        : (encryptMap(input.env) ?? existing?.envCiphertext ?? null)
      const headersCiphertext = input.removeHeaders
        ? null
        : (encryptMap(input.headers) ?? existing?.headersCiphertext ?? null)
      const updatedAt = new Date()
      const record = {
        id: input.id,
        name: input.name,
        description: input.description,
        transport: input.transport,
        enabled: input.enabled,
        trusted: input.trusted,
        command: input.command ?? null,
        argsJson: JSON.stringify(input.args),
        url: input.url ?? null,
        timeoutMs: input.timeoutMs,
        envCiphertext,
        headersCiphertext,
        disabledToolsJson: JSON.stringify(input.disabledTools),
        updatedAt,
      } as const
      const changed =
        !existing || serverFingerprint({ ...existing, ...record }) !== serverFingerprint(existing)
      upsertMcpServerConfigRecord(client, record)
      if (changed || !input.enabled) await closeConnection(input.id)
      if (!input.enabled) runtime.delete(input.id)
      notify()
      return publicServer(requireRecord(input.id), runtime.get(input.id))
    },
    deleteServer: async (serverId) => {
      requireRecord(serverId)
      await closeConnection(serverId)
      deleteMcpServerConfigRecord(client, serverId)
      runtime.delete(serverId)
      notify()
    },
    testServer: async (serverId) => {
      const record = requireRecord(serverId)
      try {
        const tools = await listToolsForRecord(record)
        return { server: publicServer(record, runtime.get(serverId)), tools }
      } finally {
        if (!record.enabled) {
          await closeConnection(serverId)
        }
      }
    },
    createAgentTools: async (signal) => {
      const records = listMcpServerConfigRecords(client).filter((record) => record.enabled && record.trusted)
      const results = await Promise.allSettled(
        records.map(async (record) => ({ record, tools: await listToolsForRecord(record) })),
      )
      return results.flatMap((result) => {
        if (result.status === "rejected") return []
        const { record, tools } = result.value
        return tools
          .filter((tool) => tool.enabled)
          .map(
            (tool): ExternalAgentTool => ({
              id: mcpToolId(record.id, tool.name),
              title: `${record.name} / ${tool.title ?? tool.name}`,
              description: tool.description ?? `调用 ${record.name} 提供的 MCP 工具 ${tool.name}`,
              inputSchema: tool.inputSchema,
              execute: async (input, context) => {
                if (signal.aborted || context.signal.aborted)
                  throw new DOMException("MCP 调用已取消", "AbortError")
                const latest = requireRecord(record.id)
                if (!latest.enabled || !latest.trusted) throw new McpConfigError("这个 MCP 服务器已经停用。")
                if (parseStringArray(latest.disabledToolsJson, "禁用工具").includes(tool.name)) {
                  throw new McpConfigError("这个 MCP 工具已经停用。")
                }
                const mcpClient = await getClient(latest)
                const resolved = resolveRecord(latest)
                try {
                  const output = await mcpClient.callTool(tool.name, input, context.signal)
                  return redactOutput(output, resolved)
                } catch (error) {
                  throw new McpConfigError(redactError(error, resolved).slice(0, 500))
                }
              },
            }),
          )
      })
    },
    close: async () => {
      closed = true
      const serverIds = new Set([...connections.keys(), ...pendingConnections.keys()])
      await Promise.allSettled([...serverIds].map((serverId) => closeConnection(serverId)))
      connections.clear()
      runtime.clear()
    },
  }
}
