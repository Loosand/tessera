/**
 * [INPUT]: 长文本、空摘要与流式状态下的 AI SDK reasoning Part
 * [OUTPUT]: 思考区域无左侧时间线、限高、独立滚动、流式光标、无字符重播、可访问状态与完成态空摘要仅保留阶段外壳的回归验证
 * [POS]: reasoning-part 的布局边界单元测试
 * [DOC]: design.md、docs/architecture/ai-observability.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReasoningPart } from "./reasoning-part"

const reasoningPart = {
  type: "reasoning",
  text: Array.from({ length: 20 }, (_, index) => `思考第 ${index + 1} 行`).join("\n\n"),
  state: "streaming",
} as Extract<UIMessage["parts"][number], { type: "reasoning" }>

describe("思考过程区域", () => {
  it("在独立可访问区域内限制最大高度并允许滚动", () => {
    const markup = renderToStaticMarkup(<ReasoningPart part={reasoningPart} streaming />)

    expect(markup).toContain("max-h-48")
    expect(markup).toContain("overflow-y-auto")
    expect(markup).toContain('aria-label="模型思考过程"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('data-streaming="true"')
    expect(markup).not.toContain("data-sd-animate")
    expect(markup).toContain("--streamdown-caret")
    expect(markup).not.toContain("border-l")
  })

  it("供应商只返回 reasoning 生命周期时保留阶段外壳但不显示占位正文", () => {
    const emptyPart = {
      type: "reasoning",
      text: "",
      state: "done",
    } as Extract<UIMessage["parts"][number], { type: "reasoning" }>

    const markup = renderToStaticMarkup(<ReasoningPart part={emptyPart} streaming={false} />)

    expect(markup).toContain("思考完成")
    expect(markup).toContain('aria-label="模型思考阶段"')
    expect(markup).not.toContain("模型未返回可展示的思考文本")
    expect(markup).not.toContain("正在生成思考过程")
    expect(markup).not.toContain("aria-expanded")
  })

  it("流式空生命周期只显示整体思考状态，不提前制造可展开正文", () => {
    const emptyPart = {
      type: "reasoning",
      text: "",
      state: "streaming",
    } as Extract<UIMessage["parts"][number], { type: "reasoning" }>

    const markup = renderToStaticMarkup(<ReasoningPart part={emptyPart} streaming />)

    expect(markup).toContain("思考中")
    expect(markup).toContain('aria-busy="true"')
    expect(markup).not.toContain("正在生成思考过程")
    expect(markup).not.toContain("aria-expanded")
  })
})
