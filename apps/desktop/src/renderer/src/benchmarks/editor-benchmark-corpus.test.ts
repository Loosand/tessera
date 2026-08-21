/**
 * [INPUT]: 编辑器性能基准语料生成器
 * [OUTPUT]: 语料规模、结构差异与确定性的回归测试
 * [POS]: 性能基准输入稳定性的自动化保障
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { createEditorBenchmarkScenarios } from "./editor-benchmark-corpus"

describe("editor-benchmark-corpus", () => {
  it("生成固定顺序且规模达标的四类语料", () => {
    const scenarios = createEditorBenchmarkScenarios()

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "plain-10k",
      "plain-100k",
      "many-blocks-100k",
      "mixed-50k",
    ])
    expect(scenarios[0]?.markdown.length).toBeGreaterThanOrEqual(10_000)
    expect(scenarios[1]?.markdown.length).toBeGreaterThanOrEqual(100_000)
    expect(scenarios[2]?.markdown.length).toBeGreaterThanOrEqual(100_000)
    expect(scenarios[3]?.markdown.length).toBeGreaterThanOrEqual(50_000)
  })

  it("密集块与复杂语料保持各自的压力特征", () => {
    const scenarios = createEditorBenchmarkScenarios()
    const manyBlocks = scenarios.find((scenario) => scenario.id === "many-blocks-100k")
    const mixed = scenarios.find((scenario) => scenario.id === "mixed-50k")

    expect(manyBlocks?.markdown.split("\n\n")).toHaveLength(2_000)
    expect(mixed?.markdown).toContain("| 指标 | 当前值 | 目标 |")
    expect(mixed?.markdown).toContain("```ts")
    expect(createEditorBenchmarkScenarios()).toEqual(scenarios)
  })
})
