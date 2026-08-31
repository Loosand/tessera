/**
 * [INPUT]: 固定块数 Markdown 语料、Tessera 编辑器扩展与 Bun CPU profiler 参数
 * [OUTPUT]: MarkdownManager.parse 块数增长曲线的 JSON/Markdown 报告
 * [POS]: 不挂载 DOM 的独立解析热点与保护阈值验证 runner
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, writeFile } from "node:fs/promises"
import { cpus, platform, release } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { MarkdownManager } from "@tiptap/markdown"
import { createPlainEditorBenchmarkDocument } from "../src/renderer/src/benchmarks/editor-benchmark-corpus"
import { EDITOR_EXTENSIONS } from "../src/renderer/src/components/documents/editor/editor-extensions"
import { estimateMarkdownBlockCount } from "../src/renderer/src/components/documents/editor/editor-mode-policy"

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_DIRECTORY = resolve(SCRIPT_DIRECTORY, "../../..")
const REPORT_DIRECTORY = resolve(REPOSITORY_DIRECTORY, "artifacts/benchmarks/editor-parser")
const FOCUSED_PROFILE = process.argv.includes("--focus")
const BLOCK_COUNTS = FOCUSED_PROFILE ? [1_000] : [100, 250, 500, 750, 1_000, 1_500]
const manager = new MarkdownManager({
  extensions: EDITOR_EXTENSIONS,
  markedOptions: { breaks: false, gfm: true },
})

function sampleCount(blockCount: number) {
  if (FOCUSED_PROFILE) return 4
  if (blockCount >= 1_500) return 2
  if (blockCount >= 1_000) return 3
  if (blockCount >= 750) return 4
  return 5
}

function percentile(samples: number[], value: number) {
  const sorted = samples.toSorted((left, right) => left - right)
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1)
  return sorted[index] ?? 0
}

function round(value: number) {
  return Number(value.toFixed(3))
}

function summarize(samples: number[]) {
  return {
    max: round(Math.max(...samples)),
    median: round(percentile(samples, 50)),
    min: round(Math.min(...samples)),
    p95: round(percentile(samples, 95)),
    samples: samples.map(round),
  }
}

function createMarkdownReport(report: ParserProfileReport) {
  const lines = [
    "# Tessera Markdown 解析块数 Profile",
    "",
    `- 时间：${report.generatedAt}`,
    `- 环境：${report.environment.os} / ${report.environment.cpu}`,
    `- Bun：${report.environment.bun}`,
    `- 模式：${report.focused ? "CPU 热点采样" : "块数增长曲线"}`,
    "",
    "| 目标块数 | 估算块数 | 字符数 | 样本数 | median | p95 | min | max |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.blockCount} | ${scenario.estimatedBlocks} | ${scenario.characterCount} | ${scenario.parseMs.samples.length} | ${scenario.parseMs.median.toFixed(2)}ms | ${scenario.parseMs.p95.toFixed(2)}ms | ${scenario.parseMs.min.toFixed(2)}ms | ${scenario.parseMs.max.toFixed(2)}ms |`,
    )
  }

  lines.push(
    "",
    "> 本报告只测量 `MarkdownManager.parse`，用于判断块数增长曲线；真实打开体验仍以 Electron renderer 基准为准。",
  )
  return lines.join("\n")
}

interface ParserProfileReport {
  environment: {
    bun: string
    cpu: string
    os: string
  }
  focused: boolean
  generatedAt: string
  scenarios: Array<{
    blockCount: number
    characterCount: number
    estimatedBlocks: number
    parseMs: ReturnType<typeof summarize>
  }>
}

async function runProfile() {
  const scenarios: ParserProfileReport["scenarios"] = []
  manager.parse(createPlainEditorBenchmarkDocument(20, 40))

  for (const blockCount of BLOCK_COUNTS) {
    const markdown = createPlainEditorBenchmarkDocument(blockCount, 40)
    const samples: number[] = []
    for (let index = 0; index < sampleCount(blockCount); index += 1) {
      const startedAt = performance.now()
      const parsed = manager.parse(markdown)
      samples.push(performance.now() - startedAt)
      if (!parsed.content) throw new Error(`解析 ${blockCount} 块语料后没有文档内容。`)
    }

    scenarios.push({
      blockCount,
      characterCount: markdown.length,
      estimatedBlocks: estimateMarkdownBlockCount(markdown),
      parseMs: summarize(samples),
    })
  }

  const report: ParserProfileReport = {
    environment: {
      bun: Bun.version,
      cpu: cpus()[0]?.model ?? "unknown",
      os: `${platform()} ${release()}`,
    },
    focused: FOCUSED_PROFILE,
    generatedAt: new Date().toISOString(),
    scenarios,
  }
  const markdown = `${createMarkdownReport(report)}\n`
  const json = `${JSON.stringify(report, null, 2)}\n`
  const timestamp = report.generatedAt.replaceAll(":", "-").replaceAll(".", "-")
  const latestName = FOCUSED_PROFILE ? "latest-cpu" : "latest"

  await mkdir(REPORT_DIRECTORY, { recursive: true })
  await Promise.all([
    writeFile(resolve(REPORT_DIRECTORY, `${latestName}.json`), json),
    writeFile(resolve(REPORT_DIRECTORY, `${latestName}.md`), markdown),
    writeFile(resolve(REPORT_DIRECTORY, `${timestamp}.json`), json),
    writeFile(resolve(REPORT_DIRECTORY, `${timestamp}.md`), markdown),
  ])
  process.stdout.write(markdown)
}

await runProfile()
