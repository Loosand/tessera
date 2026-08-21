/**
 * [INPUT]: 精选模型品牌匹配规则与真实供应商模型 ID 样例
 * [OUTPUT]: 品牌头像解析及未知模型回退的回归保证
 * [POS]: @tessera/ai/react 模型图标体积边界的纯逻辑测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { resolveAiModelIconBrand } from "./ai-model-icon"

describe("resolveAiModelIconBrand", () => {
  it.each([
    ["openai/gpt-5.2", "openai"],
    ["anthropic/claude-sonnet-4.5", "claude"],
    ["deepseek/deepseek-v4", "deepseek"],
    ["x-ai/grok-4", "grok"],
    ["google/gemini-3-pro", "gemini"],
    ["qwen/qwen3-coder", "qwen"],
    ["meta-llama/llama-4", "meta"],
    ["mistralai/mistral-large", "mistral"],
    ["moonshotai/kimi-k2", "moonshot"],
    ["z-ai/glm-5", "zai"],
    ["minimax/minimax-m2", "minimax"],
    ["perplexity/sonar-pro", "perplexity"],
    ["cohere/command-r-plus", "cohere"],
    ["openrouter/auto", "openrouter"],
  ] as const)("将 %s 解析为 %s", (modelId, brand) => {
    expect(resolveAiModelIconBrand(modelId)).toBe(brand)
  })

  it("未知模型返回 undefined 以使用中性头像", () => {
    expect(resolveAiModelIconBrand("local/custom-model")).toBeUndefined()
  })
})
