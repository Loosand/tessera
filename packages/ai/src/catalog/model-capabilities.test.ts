/**
 * [INPUT]: 供应商标识、常见模型 ID 与不同来源的能力声明
 * [OUTPUT]: 内建能力推断和远端能力优先级的回归验证
 * [POS]: 模型能力归一化层的单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { resolveAiModelCapabilities } from "./model-capabilities"

const model = (id: string) => ({
  id,
  name: null,
  ownedBy: null,
  contextWindow: null,
  maxOutputTokens: null,
})

describe("模型能力归一化", () => {
  it("统一识别 DeepSeek V4 的模态、能力、限额和端点", () => {
    const resolved = resolveAiModelCapabilities("deepseek", model("deepseek-v4-flash-vision-exp"))
    expect(resolved).toMatchObject({
      capabilities: {
        functionCall: "supported",
        reasoning: "supported",
        structuredOutput: "supported",
      },
      contextWindow: 1_048_576,
      inputModalities: ["text", "image"],
      maxOutputTokens: 393_216,
      modelType: "chat",
    })
    expect(resolved.endpointBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpointType: "openai-responses",
          nativeWebSearch: "supported",
        }),
      ]),
    )
  })

  it("内建能力会随版本更新重新计算", () => {
    expect(
      resolveAiModelCapabilities("deepseek", {
        ...model("deepseek-v4-flash-vision-exp"),
        capabilitySource: "builtin",
        capabilities: {
          functionCall: "unsupported",
          reasoning: "unknown",
          structuredOutput: "unknown",
        },
      }).capabilities?.functionCall,
    ).toBe("supported")
  })

  it("不会把旧版 DeepSeek 模型标成原生联网模型", () => {
    expect(
      resolveAiModelCapabilities("deepseek", model("deepseek-v3.1")).endpointBindings?.some(
        (binding) => binding.nativeWebSearch === "supported",
      ),
    ).toBe(false)
  })

  it("保留远端目录明确声明的能力", () => {
    expect(
      resolveAiModelCapabilities("openrouter", {
        ...model("vendor/model"),
        capabilitySource: "remote",
        capabilities: {
          functionCall: "supported",
          reasoning: "supported",
          structuredOutput: "supported",
        },
      }).capabilities,
    ).toEqual({
      functionCall: "supported",
      reasoning: "supported",
      structuredOutput: "supported",
    })
  })
})
