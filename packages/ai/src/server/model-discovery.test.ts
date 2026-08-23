/**
 * [INPUT]: 模型目录适配器、模拟 HTTP 响应与不同供应商连接配置
 * [OUTPUT]: URL 推导、密钥请求头校验、鉴权、模型 ID/数值边界、响应归一化和错误脱敏的回归验证
 * [POS]: @tessera/ai/server 模型发现单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderConnectionInput } from "@tessera/contracts"
import { describe, expect, it, vi } from "vitest"
import { createAiModelCatalogUrl, listAiProviderModels } from "./model-discovery"

const OPENAI_CONNECTION: AiProviderConnectionInput = {
  configId: "openai-compatible",
  providerId: "openai-compatible",
  apiKey: "secret-key",
  baseUrl: "https://api.openai.com/v1",
}

describe("AI 模型目录发现", () => {
  it("从 API 根地址推导模型目录且避免重复 models 路径", () => {
    expect(createAiModelCatalogUrl("openai-compatible", "https://example.com/v1/")).toBe(
      "https://example.com/v1/models",
    )
    expect(createAiModelCatalogUrl("openrouter", "https://openrouter.ai/api/v1/models")).toBe(
      "https://openrouter.ai/api/v1/models",
    )
    expect(createAiModelCatalogUrl("anthropic-compatible", "https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1/models?limit=1000",
    )
  })

  it("使用 Bearer 鉴权并归一化 data 模型列表", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-b", owned_by: "openai", context_length: 128_000 },
              { id: "gpt-a", name: "GPT A", max_output_tokens: 16_000 },
              { id: "gpt-b" },
            ],
          }),
          { status: 200 },
        ),
    )

    await expect(listAiProviderModels(OPENAI_CONNECTION, { fetch: fetcher })).resolves.toEqual([
      {
        id: "gpt-b",
        name: null,
        ownedBy: "openai",
        contextWindow: 128_000,
        maxOutputTokens: null,
      },
      {
        id: "gpt-a",
        name: "GPT A",
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: 16_000,
      },
    ])
    const [, request] = fetcher.mock.calls[0] ?? []
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer secret-key")
  })

  it("忽略超长模型 ID，并拒绝不安全或非整数的 Token 限额", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "m".repeat(513), context_length: 128_000 },
              {
                id: "valid-model",
                context_length: 0.5,
                max_output_tokens: Number.MAX_SAFE_INTEGER + 1,
              },
            ],
          }),
          { status: 200 },
        ),
    )

    await expect(listAiProviderModels(OPENAI_CONNECTION, { fetch: fetcher })).resolves.toEqual([
      {
        id: "valid-model",
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
      },
    ])
  })

  it("公共模型目录没有 API Key 时不发送 Authorization", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: [{ id: "openrouter/auto" }] }), { status: 200 }),
    )

    await expect(
      listAiProviderModels(
        {
          configId: "openrouter",
          providerId: "openrouter",
          apiKey: "",
          baseUrl: "https://openrouter.ai/api/v1",
        },
        { fetch: fetcher },
      ),
    ).resolves.toHaveLength(1)
    const [, request] = fetcher.mock.calls[0] ?? []
    expect(new Headers(request?.headers).has("authorization")).toBe(false)
  })

  it("在创建请求头前拒绝包含中文的 API Key", async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(
      listAiProviderModels({ ...OPENAI_CONNECTION, apiKey: "我的 API Key" }, { fetch: fetcher }),
    ).rejects.toThrow("请只粘贴供应商提供的原始 Key")
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("读取 OpenRouter 返回的输入模态与可选参数能力", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "vendor/vision-reasoner",
                architecture: { input_modalities: ["text", "image"] },
                supported_parameters: ["reasoning_effort", "tools"],
              },
            ],
          }),
          { status: 200 },
        ),
    )

    await expect(
      listAiProviderModels(
        {
          configId: "openrouter",
          providerId: "openrouter",
          apiKey: "",
          baseUrl: "https://openrouter.ai/api/v1",
        },
        { fetch: fetcher },
      ),
    ).resolves.toEqual([
      {
        id: "vendor/vision-reasoner",
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
        capabilitySources: {
          functionCall: "remote",
          reasoning: "remote",
          structuredOutput: "remote",
        },
        capabilities: {
          functionCall: "supported",
          reasoning: "supported",
          structuredOutput: "unknown",
        },
        fieldSources: { inputModalities: "remote" },
        inputModalities: ["text", "image"],
      },
    ])
  })

  it("为 Anthropic 使用原生请求头并识别 display_name", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "claude-a", display_name: "Claude A" }] }), {
          status: 200,
        }),
    )

    await expect(
      listAiProviderModels(
        {
          configId: "anthropic-compatible",
          providerId: "anthropic-compatible",
          apiKey: "anthropic-secret",
          baseUrl: "https://api.anthropic.com/v1",
        },
        { fetch: fetcher },
      ),
    ).resolves.toEqual([
      {
        id: "claude-a",
        name: "Claude A",
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
      },
    ])
    const [, request] = fetcher.mock.calls[0] ?? []
    const headers = new Headers(request?.headers)
    expect(headers.get("x-api-key")).toBe("anthropic-secret")
    expect(headers.get("anthropic-version")).toBe("2023-06-01")
    expect(headers.has("authorization")).toBe(false)
  })

  it("兼容 xAI 的 models 根字段", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ models: [{ id: "grok-latest" }] }), { status: 200 }),
    )
    await expect(
      listAiProviderModels(
        {
          configId: "grok",
          providerId: "grok",
          apiKey: "xai-key",
          baseUrl: "https://api.x.ai/v1",
        },
        { fetch: fetcher },
      ),
    ).resolves.toEqual([
      {
        id: "grok-latest",
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
      },
    ])
  })

  it("可从完整推理端点和无版本的兼容根地址推导目录", () => {
    expect(
      createAiModelCatalogUrl("openai-compatible", "https://relay.example.com/custom/v1/chat/completions"),
    ).toBe("https://relay.example.com/custom/v1/models")
    expect(createAiModelCatalogUrl("openai-compatible", "https://relay.example.com/api")).toBe(
      "https://relay.example.com/api/v1/models",
    )
    expect(createAiModelCatalogUrl("deepseek", "https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/models",
    )
    expect(() =>
      createAiModelCatalogUrl("openai-compatible", "https://relay.example.com/v1?token=secret"),
    ).toThrow("不能包含查询参数")
  })

  it("Anthropic 兼容地址先尝试 Bearer，失败后回退原生鉴权", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "bearer unsupported" } }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "claude-relay" }] }), { status: 200 }),
      )

    await expect(
      listAiProviderModels(
        {
          configId: "anthropic-compatible",
          providerId: "anthropic-compatible",
          apiKey: "relay-key",
          baseUrl: "https://relay.example.com/anthropic/v1",
        },
        { fetch: fetcher },
      ),
    ).resolves.toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer relay-key")
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("x-api-key")).toBe("relay-key")
  })

  it("兼容端点未实现模型目录时允许用户改为手动添加模型", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 }),
    )

    const request = listAiProviderModels(
      {
        configId: "anthropic-compatible:deepseek",
        providerId: "anthropic-compatible",
        apiKey: "deepseek-key",
        baseUrl: "https://api.deepseek.com/anthropic",
      },
      { fetch: fetcher },
    )

    await expect(request).rejects.toMatchObject({
      code: "catalog-unsupported",
      message: "此兼容端点未提供模型目录；这不影响推理，请手动添加模型 ID。",
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("错误信息不会回显 API Key", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { message: "invalid secret-key" } }), { status: 401 }),
    )
    await expect(listAiProviderModels(OPENAI_CONNECTION, { fetch: fetcher })).rejects.toThrow(
      "invalid [已隐藏]",
    )
  })

  it("拒绝超过 2 MiB 的模型目录响应", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(2 * 1_024 * 1_024 + 1) },
        }),
    )
    await expect(listAiProviderModels(OPENAI_CONNECTION, { fetch: fetcher })).rejects.toThrow("响应过大")
  })
})
