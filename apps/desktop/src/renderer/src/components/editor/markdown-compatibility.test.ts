/**
 * [INPUT]: Markdown 兼容性分析、统一扩展与高风险语法语料
 * [OUTPUT]: 嵌套列表/复杂表格保真和源码优先语法识别的回归保障
 * [POS]: 富文本 Markdown 能力边界的兼容性语料测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { MarkdownManager } from "@tiptap/markdown"
import { describe, expect, it } from "vitest"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import { findSourceOnlyMarkdownSyntax } from "./markdown-compatibility"

const markdownManager = new MarkdownManager({
  extensions: EDITOR_EXTENSIONS,
  markedOptions: { breaks: false, gfm: true },
})

function roundTrip(markdown: string) {
  return markdownManager.serialize(markdownManager.parse(markdown))
}

describe("富文本可保真语料", () => {
  it("稳定往返混合嵌套列表", () => {
    const markdown = `- 一级
  - 二级
    1. 三级
       - [x] 中文任务
- 末尾`
    const first = roundTrip(markdown)

    expect(roundTrip(first)).toBe(first)
    expect(first).toContain("    1. 三级")
    expect(first).toContain("- [x] 中文任务")
  })

  it("稳定往返包含管道符、行内代码和对齐的复杂表格", () => {
    const markdown = `| 名称 | 描述 | 状态 |
| :--- | :---: | ---: |
| 代码 | \`a | b\` | **正常** |
| 文本 | a\\|b | [链\\|接](https://example.com) |`
    const first = roundTrip(markdown)
    const reparsed = markdownManager.parse(first)

    expect(roundTrip(first)).toBe(first)
    expect(first).toContain("`a \\| b`")
    expect(first).toContain("a\\|b")
    expect(first).toContain("[链\\|接](https://example.com)")
    expect(reparsed.content?.[0]?.content).toHaveLength(3)
    expect(reparsed.content?.[0]?.content?.every((row) => row.content?.length === 3)).toBe(true)
  })
})

describe("源码优先语料", () => {
  it.each([
    ["未知 HTML", "正文\n\n<details open>内容</details>", ["raw-html"]],
    ["脚注", "正文[^note]\n\n[^note]: 注释", ["footnote"]],
    ["定义式链接", "[Tessera][site]\n\n[site]: https://example.com", ["definition-link"]],
  ])("识别%s，避免静默规范化", (_name, markdown, expected) => {
    expect(findSourceOnlyMarkdownSyntax(markdown)).toEqual(expected)
  })

  it("忽略 frontmatter、代码围栏、缩进代码和行内代码中的语法样例", () => {
    const markdown = `---
example: <details>
---

\`<span>行内样例</span>\`

~~~md
<details>围栏样例</details>
[^note]: 围栏脚注
~~~

    <aside>缩进代码</aside>`

    expect(findSourceOnlyMarkdownSyntax(markdown)).toEqual([])
  })

  it("不把 GFM 自动链接识别成 HTML", () => {
    expect(findSourceOnlyMarkdownSyntax("<https://example.com> 与 <hello@example.com>")).toEqual([])
  })
})
