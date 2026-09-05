/**
 * [INPUT]: 五类供应商配置、联网搜索额度与真实 AI SDK provider 工厂
 * [OUTPUT]: 密钥/地址/模型 ID 边界、供应商到 AI SDK LanguageModel、DeepSeek 稳定搜索协议及无 thinking 工具续轮 wire shape 的映射回归验证
 * [POS]: @tessera/ai/server AI SDK 适配器单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import type { AiProviderId } from "@tessera/contracts"
import { type ModelMessage, generateText, tool } from "ai"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createAiSdkChatRuntime, createAiSdkLanguageModel } from "./ai-sdk-runtime"

describe("AI SDK 供应商适配", () => {
  it.each<[AiProviderId, string, string]>([
    ["openai-compatible", "https://api.openai.com/v1", "openai-model"],
    ["anthropic-compatible", "https://api.anthropic.com/v1", "claude-model"],
    ["deepseek", "https://api.deepseek.com", "deepseek-model"],
    ["grok", "https://api.x.ai/v1", "grok-model"],
    ["openrouter", "https://openrouter.ai/api/v1", "provider/model"],
  ])("为 %s 创建 AI SDK LanguageModel", (providerId, baseUrl, modelId) => {
    const model = createAiSdkLanguageModel({
      configId: providerId,
      providerId,
      baseUrl,
      modelId,
      apiKey: "test-key",
    })
    expect(model).toMatchObject({ modelId })
  })

  it("拒绝缺失的模型 ID", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        modelId: " ",
        apiKey: "test-key",
      }),
    ).toThrow("请先选择模型")
  })

  it("在创建供应商客户端前拒绝包含中文的 API Key", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openrouter",
        providerId: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelId: "provider/model",
        apiKey: "我的 API Key",
      }),
    ).toThrow("请只粘贴供应商提供的原始 Key")
  })

  it("拒绝非 HTTP(S) 的运行时地址", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: "file:///tmp/models",
        modelId: "model-a",
        apiKey: "test-key",
      }),
    ).toThrow("有效的 http(s) URL")
  })

  it("在创建供应商客户端前拒绝超长 API 地址和模型 ID", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: `https://example.com/${"a".repeat(2_048)}`,
        modelId: "model-a",
        apiKey: "test-key",
      }),
    ).toThrow("请输入有效的 API 地址")
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: "https://example.com/v1",
        modelId: "m".repeat(513),
        apiKey: "test-key",
      }),
    ).toThrow("请先选择模型")
  })

  it.each([
    ["anthropic-compatible", "https://api.anthropic.com/v1", "claude-sonnet-4", "anthropic-messages"],
    ["deepseek", "https://api.deepseek.com", "deepseek-v4-flash", "openai-responses"],
    ["grok", "https://api.x.ai/v1", "grok-4", "xai-responses"],
  ] as const)("为 %s 接入供应商原生联网工具", (providerId, baseUrl, modelId, endpointType) => {
    const runtime = createAiSdkChatRuntime(
      { configId: providerId, providerId, baseUrl, endpointType, modelId, apiKey: "test-key" },
      { webSearch: true },
    )
    expect(runtime.tools).toHaveProperty("web_search")
  })

  it("把研究模式指定的搜索额度传给 Anthropic 原生工具", () => {
    const runtime = createAiSdkChatRuntime(
      {
        configId: "anthropic-compatible",
        providerId: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com/v1",
        modelId: "claude-sonnet-4",
        apiKey: "test-key",
      },
      { webSearch: true, webSearchMaxUses: 30 },
    )
    expect(runtime.tools?.web_search).toMatchObject({ args: { maxUses: 30 } })
  })

  it("为 DeepSeek Anthropic 搜索固定稳定协议并关闭不兼容的 thinking", () => {
    const runtime = createAiSdkChatRuntime(
      {
        configId: "deepseek",
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        endpointType: "anthropic-messages",
        modelId: "deepseek-v4-flash",
        apiKey: "test-key",
      },
      { webSearch: true, webSearchMaxUses: 2 },
    )

    expect(runtime.tools?.web_search).toMatchObject({
      id: "anthropic.web_search_20250305",
      args: { maxUses: 2 },
    })
    expect(runtime.providerOptions).toEqual({
      anthropic: { sendReasoning: false, thinking: { type: "disabled" } },
    })
  })

  it("在 DeepSeek 第二轮请求中剔除旧 thinking 并保留搜索配对和本地工具结果", async () => {
    const requests: unknown[] = []
    const runtime = createAiSdkChatRuntime(
      {
        configId: "deepseek",
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        endpointType: "anthropic-messages",
        modelId: "deepseek-v4-flash",
        apiKey: "test-key",
      },
      { webSearch: true, webSearchMaxUses: 2 },
    )
    const anthropic = createAnthropic({
      apiKey: "test-key",
      baseURL: "https://api.deepseek.com/anthropic/v1",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return new Response(
          JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "captured request" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        )
      },
    })
    const tools = {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 2 }),
      bash: tool({
        description: "运行工作区命令",
        inputSchema: z.object({ command: z.string() }),
        execute: async () => ({ exitCode: 0, stdout: "" }),
      }),
    }
    const messages = [
      { role: "user", content: "搜索专辑资料并检查工作区播客。" },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "先搜索资料，再查看工作区。",
            providerOptions: { anthropic: { signature: "deepseek-thinking-signature" } },
          },
          {
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "web_search",
            input: { query: "你的声音变了 专辑" },
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "search-1",
            toolName: "web_search",
            output: {
              type: "json",
              value: [
                {
                  type: "web_search_result",
                  url: "https://example.com/album",
                  title: "专辑资料",
                  pageAge: null,
                  encryptedContent: "encrypted-album-result",
                },
              ],
            },
          },
          {
            type: "tool-call",
            toolCallId: "search-2",
            toolName: "web_search",
            input: { query: "心愈频率三部曲" },
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "search-2",
            toolName: "web_search",
            output: {
              type: "json",
              value: [
                {
                  type: "web_search_result",
                  url: "https://example.com/trilogy",
                  title: "三部曲资料",
                  pageAge: null,
                  encryptedContent: "encrypted-trilogy-result",
                },
              ],
            },
          },
          {
            type: "tool-call",
            toolCallId: "bash-1",
            toolName: "bash",
            input: { command: "find . -type f" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "bash-1",
            toolName: "bash",
            output: { type: "json", value: { stdout: "播客/README.md", exitCode: 0 } },
          },
        ],
      },
    ] satisfies ModelMessage[]

    await expect(
      generateText({
        model: anthropic("deepseek-v4-flash"),
        tools,
        messages,
        reasoning: "high",
        ...(runtime.providerOptions ? { providerOptions: runtime.providerOptions } : {}),
        maxRetries: 0,
      }),
    ).rejects.toThrow("captured request")

    expect(requests).toHaveLength(1)
    const request = requests[0] as {
      messages: Array<{ content: Array<Record<string, unknown>>; role: string }>
      thinking: Record<string, unknown>
      tools: Array<Record<string, unknown>>
    }
    expect(request.thinking).toEqual({ type: "disabled" })
    expect(request.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "web_search", type: "web_search_20250305" })]),
    )
    expect(request.messages[1]?.content.map((part) => part.type)).toEqual([
      "server_tool_use",
      "web_search_tool_result",
      "server_tool_use",
      "web_search_tool_result",
      "tool_use",
    ])
    expect(request.messages[2]?.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "bash-1" }),
    ])
  })

  it("强制把 DeepSeek Responses 自定义模型按推理模型请求摘要", () => {
    const runtime = createAiSdkChatRuntime({
      configId: "deepseek",
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      endpointType: "openai-responses",
      modelId: "deepseek-v4-flash",
      apiKey: "test-key",
    })

    expect(runtime.providerOptions).toEqual({ openai: { forceReasoning: true } })
  })

  it("把异常搜索额度约束到运行时安全范围", () => {
    const runtime = createAiSdkChatRuntime(
      {
        configId: "anthropic-compatible",
        providerId: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com/v1",
        modelId: "claude-sonnet-4",
        apiKey: "test-key",
      },
      { webSearch: true, webSearchMaxUses: 99 },
    )
    expect(runtime.tools?.web_search).toMatchObject({ args: { maxUses: 50 } })
  })

  it("不会为能力未知的兼容端点伪装联网搜索", () => {
    expect(() =>
      createAiSdkChatRuntime(
        {
          configId: "openai-compatible",
          providerId: "openai-compatible",
          baseUrl: "https://relay.example.com/v1",
          modelId: "custom-model",
          apiKey: "test-key",
        },
        { webSearch: true },
      ),
    ).toThrow("尚未接入")
  })

  it("不会因联网开关隐式改变 DeepSeek Chat Completions 端点", () => {
    expect(() =>
      createAiSdkChatRuntime(
        {
          configId: "deepseek",
          providerId: "deepseek",
          baseUrl: "https://api.deepseek.com",
          endpointType: "openai-chat-completions",
          modelId: "deepseek-v4-flash",
          apiKey: "test-key",
        },
        { webSearch: true },
      ),
    ).toThrow("Chat Completions 端点不提供原生联网搜索")
  })
})
