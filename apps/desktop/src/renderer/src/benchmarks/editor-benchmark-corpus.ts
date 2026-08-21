/**
 * [INPUT]: 目标字符量、块数量与固定 Markdown 结构模板
 * [OUTPUT]: 可重复生成的编辑器性能基准语料矩阵
 * [POS]: 性能基准的数据输入层，不依赖 DOM 或计时器
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export interface EditorBenchmarkScenario {
  id: "many-blocks-100k" | "mixed-50k" | "plain-100k" | "plain-10k"
  label: string
  markdown: string
}

const PLAIN_TEXT =
  "Tessera 将 Markdown 保持为可审查的事实源，编辑器只承担即时交互投影。性能基准需要覆盖中文输入、长段落与稳定换行。"

export function createEditorBenchmarkScenarios(): EditorBenchmarkScenario[] {
  return [
    {
      id: "plain-10k",
      label: "纯文本 10k / 100 块",
      markdown: createPlainEditorBenchmarkDocument(100, 100),
    },
    {
      id: "plain-100k",
      label: "纯文本 100k / 1000 块",
      markdown: createPlainEditorBenchmarkDocument(1_000, 100),
    },
    {
      id: "many-blocks-100k",
      label: "小块密集 100k / 2000 块",
      markdown: createPlainEditorBenchmarkDocument(2_000, 50),
    },
    {
      id: "mixed-50k",
      label: "复杂 Markdown 50k",
      markdown: createMixedDocument(50_000),
    },
  ]
}

export function createPlainEditorBenchmarkDocument(blockCount: number, blockLength: number) {
  return Array.from({ length: blockCount }, (_, index) => {
    const prefix = `第 ${index + 1} 段：`
    return prefix + repeatToLength(PLAIN_TEXT, Math.max(1, blockLength - prefix.length))
  }).join("\n\n")
}

function createMixedDocument(targetLength: number) {
  const sections: string[] = []
  let index = 1

  while (sections.join("\n\n").length < targetLength) {
    sections.push(
      [
        `## 性能样章 ${index}`,
        `${repeatToLength(PLAIN_TEXT, 180)} **加粗内容**、[本地链接](https://example.com/${index}) 与 \`inline-code-${index}\`。`,
        `- 列表项目 ${index}.1\n- 列表项目 ${index}.2\n  - 嵌套项目 ${index}.2.1`,
        `> 引用 ${index}：${repeatToLength(PLAIN_TEXT, 90)}`,
        `- [ ] 待办 ${index}.1\n- [x] 已完成 ${index}.2`,
        `| 指标 | 当前值 | 目标 |\n| --- | ---: | ---: |\n| parse | ${index} ms | 100 ms |\n| input | ${index + 1} ms | 16 ms |`,
        `\`\`\`ts\nconst section${index} = { blocks: ${index}, stable: true }\nconsole.log(section${index})\n\`\`\``,
        "---",
      ].join("\n\n"),
    )
    index += 1
  }

  return sections.join("\n\n")
}

function repeatToLength(value: string, targetLength: number) {
  return value.repeat(Math.ceil(targetLength / value.length)).slice(0, targetLength)
}
