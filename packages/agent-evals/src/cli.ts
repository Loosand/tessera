/**
 * [INPUT]: --list 或包含 AgentEvalRunRecord[] 的本地 JSON 路径与可选报告输出路径
 * [OUTPUT]: 固定评估集目录或 Markdown 汇总报告
 * [POS]: Agent Eval 的无模型、无被测副作用命令行入口
 * [DOC]: docs/quality/agent-eval-method.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { TESSERA_CORE_EVAL_SUITE } from "./cases"
import { parseAgentEvalRunRecords } from "./parse"
import { renderAgentEvalReport } from "./report"

function argumentValue(args: readonly string[], name: string) {
  const index = args.indexOf(name)
  return index < 0 ? null : (args[index + 1] ?? null)
}

function usage() {
  return `用法：
  bun run eval:agent -- --list
  bun run eval:agent -- --input <runs.json> [--output <report.md>]
`
}

export async function runAgentEvalCli(args = process.argv.slice(2)) {
  if (args.includes("--list")) {
    process.stdout.write(
      `${TESSERA_CORE_EVAL_SUITE.cases.map((testCase) => `${testCase.id}\t${testCase.title}`).join("\n")}\n`,
    )
    return
  }
  const input = argumentValue(args, "--input")
  if (!input) throw new Error(usage())
  const raw = JSON.parse(await readFile(resolve(input), "utf8")) as unknown
  const runs = parseAgentEvalRunRecords(raw)
  const report = renderAgentEvalReport(TESSERA_CORE_EVAL_SUITE, runs)
  const output = argumentValue(args, "--output")
  if (!output) {
    process.stdout.write(report)
    return
  }
  const outputPath = resolve(output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, report, "utf8")
  process.stdout.write(`Agent Eval 报告已写入 ${outputPath}\n`)
}

if (import.meta.main) {
  runAgentEvalCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "生成 Agent Eval 报告失败。"}\n`)
    process.exitCode = 1
  })
}
