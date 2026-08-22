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
  it("识别 DeepSeek 视觉与推理模型", () => {
    expect(
      resolveAiModelCapabilities("deepseek", model("deepseek-v4-flash-vision-exp")).capabilities,
    ).toEqual({
      imageInput: "supported",
      reasoning: "supported",
      search: "unsupported",
      toolUse: "supported",
    })
  })

  it("内建能力会随版本更新重新计算", () => {
    expect(
      resolveAiModelCapabilities("deepseek", {
        ...model("deepseek-v4-flash-vision-exp"),
        capabilitySource: "builtin",
        capabilities: {
          imageInput: "unsupported",
          reasoning: "unknown",
          search: "unsupported",
          toolUse: "unknown",
        },
      }).capabilities?.imageInput,
    ).toBe("supported")
  })

  it("不会把旧版 DeepSeek 模型标成原生联网模型", () => {
    expect(resolveAiModelCapabilities("deepseek", model("deepseek-v3.1")).capabilities?.search).toBe(
      "unsupported",
    )
  })

  it("保留远端目录明确声明的能力", () => {
    expect(
      resolveAiModelCapabilities("openrouter", {
        ...model("vendor/model"),
        capabilitySource: "remote",
        capabilities: {
          imageInput: "supported",
          reasoning: "supported",
          search: "unknown",
          toolUse: "supported",
        },
      }).capabilities,
    ).toEqual({
      imageInput: "supported",
      reasoning: "supported",
      search: "unsupported",
      toolUse: "supported",
    })
  })
})
