/**
 * [INPUT]: AI 设置组件与研究网络模式读写桩
 * [OUTPUT]: 系统代理/直连选择及生效边界的静态回归验证
 * [POS]: 桌面设置页研究网络选项的渲染契约测试
 * [DOC]: docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { AiSettings } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"

describe("AI 设置", () => {
  test("呈现研究网页的系统代理和直连选择，并说明只影响后续任务", () => {
    const markup = renderToStaticMarkup(
      <AiSettings
        getResearchNetworkMode={async () => "system"}
        setResearchNetworkMode={async (mode) => mode}
      />,
    )

    expect(markup).toContain("研究网络")
    expect(markup).toContain("跟随系统代理")
    expect(markup).toContain("直接连接")
    expect(markup).toContain("每次任务启动后会冻结本次选择")
  })
})
