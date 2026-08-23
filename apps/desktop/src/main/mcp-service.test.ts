/**
 * [INPUT]: 内存 SQLite、可注入 MCP 客户端与伪安全存储
 * [OUTPUT]: MCP 信任、秘密字段边界、秘密隔离、连接生命周期、工具过滤与错误脱敏回归验证
 * [POS]: 主进程 MCP 安全边界的无网络单元测试
 * [DOC]: docs/architecture/mcp.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { McpServerSaveInput, McpToolSummary } from "@tessera/contracts"
import { openDatabase } from "@tessera/database"
import { describe, expect, test, vi } from "vitest"
import { McpConfigError, createMcpService } from "./mcp-service"

const BASE_INPUT: McpServerSaveInput = {
  id: "filesystem",
  name: "Filesystem",
  description: "读取经过授权的目录",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
  timeoutMs: 30_000,
  trusted: true,
  enabled: false,
  disabledTools: [],
}

function secretStorage() {
  return {
    isEncryptionAvailable: () => true,
    encrypt: (value: string) => Buffer.from(value, "utf8").toString("base64"),
    decrypt: (value: string) => Buffer.from(value, "base64").toString("utf8"),
  }
}

function tool(serverId: string, name: string): McpToolSummary {
  return {
    serverId,
    name,
    description: `${name} description`,
    enabled: true,
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  }
}

describe("MCP 主进程服务", () => {
  test("秘密只以密文持久化且不会通过列表返回", async () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createMcpService({
      client,
      secretStorage: secretStorage(),
      createClient: async () => {
        throw new Error("本测试不应连接")
      },
    })

    const saved = await service.saveServer({
      ...BASE_INPUT,
      env: { API_TOKEN: "top-secret" },
      headers: { Authorization: "Bearer top-secret" },
    })

    expect(saved).toMatchObject({ envConfigured: true, headersConfigured: true })
    expect(JSON.stringify(service.listServers())).not.toContain("top-secret")
    const row = client.connection
      .prepare<[], { env_ciphertext: string; headers_ciphertext: string }>(
        "SELECT env_ciphertext, headers_ciphertext FROM mcp_server_configs",
      )
      .get()
    expect(row?.env_ciphertext).not.toContain("top-secret")
    expect(row?.headers_ciphertext).not.toContain("top-secret")

    await service.close()
    client.close()
  })

  test("未确认信任时拒绝启用服务器", async () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createMcpService({
      client,
      secretStorage: secretStorage(),
      createClient: async () => {
        throw new Error("本测试不应连接")
      },
    })

    await expect(service.saveServer({ ...BASE_INPUT, trusted: false, enabled: true })).rejects.toThrow(
      McpConfigError,
    )

    await service.close()
    client.close()
  })

  test("保存时拒绝会在 Fetch 或子进程启动阶段失败的秘密字段", async () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createMcpService({
      client,
      secretStorage: secretStorage(),
      createClient: async () => {
        throw new Error("本测试不应连接")
      },
    })

    await expect(
      service.saveServer({ ...BASE_INPUT, headers: { Authorization: "Bearer 我的 Key" } }),
    ).rejects.toThrow("请求头值包含 HTTP 不支持的字符")
    await expect(service.saveServer({ ...BASE_INPUT, headers: { "错误 请求头": "value" } })).rejects.toThrow(
      "请求头名称只能使用合法的 HTTP token 字符",
    )
    await expect(service.saveServer({ ...BASE_INPUT, env: { "API=TOKEN": "secret" } })).rejects.toThrow(
      "环境变量名称不能包含等号或空字符",
    )

    expect(service.listServers()).toEqual([])
    await service.close()
    client.close()
  })

  test("读取历史配置时复核秘密字段并收口连接状态", async () => {
    const client = openDatabase({ path: ":memory:" })
    const storage = secretStorage()
    const createClient = vi.fn(async () => {
      throw new Error("本测试不应连接")
    })
    const service = createMcpService({ client, secretStorage: storage, createClient })
    await service.saveServer({ ...BASE_INPUT, enabled: true })
    const invalidHeaders = storage.encrypt(JSON.stringify({ Authorization: "Bearer 我的 Key" }))
    client.connection
      .prepare("UPDATE mcp_server_configs SET headers_ciphertext = ? WHERE id = ?")
      .run(invalidHeaders, BASE_INPUT.id)

    await expect(service.testServer(BASE_INPUT.id)).rejects.toThrow("请求头值包含 HTTP 不支持的字符")
    expect(createClient).not.toHaveBeenCalled()
    expect(service.listServers()[0]).toMatchObject({
      lastError: "请求头值包含 HTTP 不支持的字符，请只粘贴原始凭据或请求头值。",
      status: "error",
    })

    await service.close()
    client.close()
  })

  test("检测会发现工具，停用服务器检测后会释放连接", async () => {
    const client = openDatabase({ path: ":memory:" })
    const close = vi.fn(async () => undefined)
    const service = createMcpService({
      client,
      secretStorage: secretStorage(),
      createClient: async (server) => ({
        serverName: "mock-server",
        serverVersion: "1.0.0",
        close,
        listTools: async () => [tool(server.id, "search")],
        callTool: async () => ({ content: [] }),
      }),
    })
    await service.saveServer(BASE_INPUT)

    const result = await service.testServer(BASE_INPUT.id)

    expect(result.server).toMatchObject({ serverName: "mock-server", status: "disabled" })
    expect(result.tools.map((candidate) => candidate.name)).toEqual(["search"])
    expect(close).toHaveBeenCalledOnce()

    await service.close()
    client.close()
  })

  test("Agent 只接收已启用工具，并在执行前再次核对最新配置", async () => {
    const client = openDatabase({ path: ":memory:" })
    const callTool = vi.fn(async (name: string, input: unknown) => ({ name, input, leaked: "top-secret" }))
    const service = createMcpService({
      client,
      secretStorage: secretStorage(),
      createClient: async (server) => ({
        close: async () => undefined,
        listTools: async () => [tool(server.id, "search"), tool(server.id, "delete")],
        callTool,
      }),
    })
    await service.saveServer({
      ...BASE_INPUT,
      enabled: true,
      disabledTools: ["delete"],
      env: { API_TOKEN: "top-secret" },
    })

    const externalTools = await service.createAgentTools(new AbortController().signal)

    expect(externalTools).toHaveLength(1)
    expect(externalTools[0]?.id).toMatch(/^mcp__[a-f0-9]{10}__search__[a-f0-9]{6}$/u)
    const output = await externalTools[0]?.execute(
      { query: "Tessera" },
      { signal: new AbortController().signal, toolCallId: "call-1" },
    )
    expect(callTool).toHaveBeenCalledWith("search", { query: "Tessera" }, expect.any(AbortSignal))
    expect(output).toMatchObject({ leaked: "[已隐藏]" })

    await service.saveServer({ ...BASE_INPUT, enabled: false })
    await expect(
      externalTools[0]?.execute(
        { query: "stale" },
        { signal: new AbortController().signal, toolCallId: "call-2" },
      ),
    ).rejects.toThrow("已经停用")

    await service.close()
    client.close()
  })

  test("连接错误会隐藏解密后的秘密", async () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createMcpService({
      client,
      secretStorage: secretStorage(),
      createClient: async (server) => {
        throw new Error(`认证失败：${server.env.API_TOKEN}`)
      },
    })
    await service.saveServer({ ...BASE_INPUT, env: { API_TOKEN: "top-secret" } })

    await expect(service.testServer(BASE_INPUT.id)).rejects.toThrow("认证失败：[已隐藏]")
    expect(service.listServers()[0]?.lastError).toBe("认证失败：[已隐藏]")
    expect(JSON.stringify(service.listServers())).not.toContain("top-secret")

    await service.close()
    client.close()
  })
})
