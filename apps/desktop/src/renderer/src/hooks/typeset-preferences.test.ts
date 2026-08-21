/**
 * [INPUT]: Typeset 偏好校验、旧设置迁移、参考/随机预设与 CSS 变量映射
 * [OUTPUT]: Markdown 主题持久化、随机搭配和运行时样式协议的回归保障
 * [POS]: Typeset 偏好纯数据协议的单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  TYPESET_REFERENCE_PRESET,
  createRandomTypesetPreferences,
  createTypesetCssVariables,
  readTypesetPreferences,
} from "./typeset-preferences"

describe("Typeset preferences", () => {
  it("使用 shadcn Typeset 参考链接作为新用户预设", () => {
    expect(TYPESET_REFERENCE_PRESET).toEqual({
      typesetBodyFont: "oxanium",
      typesetFlow: 1,
      typesetHeadingFont: "nunito-sans",
      typesetLeading: 1.9,
      typesetMeasure: 70,
      typesetMonoFont: "jetbrains-mono",
      typesetSize: 18,
    })
    expect(readTypesetPreferences({})).toEqual(TYPESET_REFERENCE_PRESET)
  })

  it("只从精选字体与可读节奏中生成随机搭配", () => {
    const samples = [0, 0.99, 0.5, 0.25, 0.75, 0.1]
    let sampleIndex = 0
    const preferences = createRandomTypesetPreferences(() => samples[sampleIndex++] ?? 0)

    expect(preferences).toEqual({
      typesetBodyFont: "oxanium",
      typesetFlow: 1.75,
      typesetHeadingFont: "nunito-sans",
      typesetLeading: 1.75,
      typesetMeasure: 70,
      typesetMonoFont: "jetbrains-mono",
      typesetSize: 14,
    })
  })

  it("保留有效的自定义字体与阅读节奏", () => {
    expect(
      readTypesetPreferences({
        typesetBodyFont: "open-sans",
        typesetFlow: 1.5,
        typesetHeadingFont: "geist",
        typesetLeading: 1.9,
        typesetMeasure: 72,
        typesetMonoFont: "system-mono",
        typesetSize: 18,
      }),
    ).toEqual({
      typesetBodyFont: "open-sans",
      typesetFlow: 1.5,
      typesetHeadingFont: "geist",
      typesetLeading: 1.9,
      typesetMeasure: 72,
      typesetMonoFont: "system-mono",
      typesetSize: 18,
    })
  })

  it("把旧版正文排版偏好迁移为等价 Typeset 设置", () => {
    expect(readTypesetPreferences({ editorFont: "serif", editorFontSize: 17, editorWidth: "wide" })).toEqual({
      typesetBodyFont: "system-serif",
      typesetFlow: 1.25,
      typesetHeadingFont: "system-serif",
      typesetLeading: 1.75,
      typesetMeasure: 104,
      typesetMonoFont: "system-mono",
      typesetSize: 17,
    })
  })

  it("拒绝未知字体与越界节奏并生成完整 CSS 变量", () => {
    const preferences = readTypesetPreferences({
      typesetBodyFont: "remote-font",
      typesetFlow: 5,
      typesetHeadingFont: "montserrat",
      typesetLeading: 0.5,
      typesetMeasure: 500,
      typesetMonoFont: "remote-mono",
      typesetSize: 8,
    })

    expect(preferences).toEqual({
      ...TYPESET_REFERENCE_PRESET,
      typesetHeadingFont: "montserrat",
    })
    expect(createTypesetCssVariables(preferences)).toMatchObject({
      "--editor-measure": "70ch",
      "--editor-typeset-flow": "1em",
      "--editor-typeset-leading": "1.9",
      "--editor-typeset-size": "18px",
    })
  })
})
