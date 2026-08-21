/**
 * [INPUT]: 生产渲染构建、编辑器基准 Promise 与版本化性能预算
 * [OUTPUT]: JSON/Markdown 性能报告及可选 CI 超限退出码
 * [POS]: 隔离 Electron BrowserWindow 与仓库基准产物之间的 runner
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { cpus, freemem, platform, release, totalmem } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BrowserWindow, app } from "electron"

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIRECTORY = resolve(SCRIPT_DIRECTORY, "..")
const REPOSITORY_DIRECTORY = resolve(DESKTOP_DIRECTORY, "../..")
const RENDERER_ENTRY = resolve(DESKTOP_DIRECTORY, "out/renderer/index.html")
const BUDGET_PATH = resolve(DESKTOP_DIRECTORY, "benchmarks/editor-budget.json")
const REPORT_DIRECTORY = resolve(REPOSITORY_DIRECTORY, "artifacts/benchmarks/editor")
const CHECK_BUDGET = process.argv.includes("--check")
const METRIC_READERS = {
  heapDeltaMiB: (scenario) => scenario.heapDeltaMiB,
  hoverToFrameP95Ms: (scenario) => scenario.hoverToFrameMs.p95,
  inputToFrameP95Ms: (scenario) => scenario.inputToFrameMs.p95,
  openToFrameP95Ms: (scenario) => scenario.openToFrameMs.p95,
  parseP95Ms: (scenario) => scenario.parseMs.p95,
  scrollFrameP95Ms: (scenario) => scenario.scrollFrameMs.p95,
  serializeP95Ms: (scenario) => scenario.serializeMs.p95,
  slowFrameRate: (scenario) => scenario.slowFrameRate,
  transactionP95Ms: (scenario) => scenario.transactionMs.p95,
}

app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("enable-precise-memory-info")
app.commandLine.appendSwitch("js-flags", "--expose-gc")
app.setName("Tessera Editor Benchmark")

void app
  .whenReady()
  .then(runBenchmark)
  .catch((error) => {
    console.error("编辑器性能基准失败。", error)
    process.exitCode = 1
  })
  .finally(() => app.quit())

async function runBenchmark() {
  const window = new BrowserWindow({
    focusable: false,
    frame: false,
    height: 1000,
    opacity: 0.05,
    show: true,
    skipTaskbar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 1440,
  })

  window.webContents.on("console-message", (details) => {
    if (details.message.startsWith("[editor-benchmark]")) {
      process.stdout.write(`${details.message}\n`)
    }
  })
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("编辑器基准渲染进程退出。", details)
  })
  window.on("unresponsive", () => {
    console.error("编辑器基准窗口暂时无响应。")
  })

  await window.loadFile(RENDERER_ENTRY, { query: { benchmark: "editor" } })
  const initialState = await window.webContents.executeJavaScript(`({
    benchmarkReady: Boolean(globalThis.__TESSERA_EDITOR_BENCHMARK__),
    bodyText: document.body.innerText,
    visibility: document.visibilityState,
  })`)
  process.stdout.write(`[editor-benchmark] 页面状态 ${JSON.stringify(initialState)}\n`)
  const rendererReport = await withTimeout(
    window.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 180000
        while (!globalThis.__TESSERA_EDITOR_BENCHMARK__) {
          if (Date.now() > deadline) throw new Error("等待编辑器基准入口超时。")
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return globalThis.__TESSERA_EDITOR_BENCHMARK__
      })()
    `),
    190_000,
  )
  const budget = JSON.parse(await readFile(BUDGET_PATH, "utf8"))
  const rendererProcessId = window.webContents.getOSProcessId()
  const rendererMetric = app.getAppMetrics().find((metric) => metric.pid === rendererProcessId)
  const report = {
    ...rendererReport,
    budget: evaluateBudget(rendererReport.scenarios, budget),
    environment: {
      ...rendererReport.environment,
      architecture: process.arch,
      chrome: process.versions.chrome,
      cpu: cpus()[0]?.model ?? "unknown",
      electron: process.versions.electron,
      freeSystemMemoryMiB: round(freemem() / 1024 / 1024),
      node: process.versions.node,
      os: `${platform()} ${release()}`,
      rendererWorkingSetMiB: rendererMetric ? round(rendererMetric.memory.workingSetSize / 1024) : null,
      totalSystemMemoryMiB: round(totalmem() / 1024 / 1024),
      v8: process.versions.v8,
    },
  }

  await writeReports(report)
  process.stdout.write(`${createMarkdownReport(report)}\n`)
  window.destroy()

  if (CHECK_BUDGET && report.budget.violations.length > 0) process.exitCode = 1
}

function evaluateBudget(scenarios, budget) {
  const evaluations = []
  for (const scenario of scenarios) {
    const limits = { ...budget.defaults, ...budget.scenarios[scenario.id] }
    for (const [metric, maximum] of Object.entries(limits)) {
      const readMetric = METRIC_READERS[metric]
      if (!readMetric || typeof maximum !== "number") continue
      const actual = readMetric(scenario)
      evaluations.push({
        actual,
        maximum,
        metric,
        passed: actual === null || actual <= maximum,
        scenarioId: scenario.id,
      })
    }
  }

  return {
    checked: CHECK_BUDGET,
    evaluations,
    passed: evaluations.every((evaluation) => evaluation.passed),
    version: budget.version,
    violations: evaluations.filter((evaluation) => !evaluation.passed),
  }
}

async function writeReports(report) {
  await mkdir(REPORT_DIRECTORY, { recursive: true })
  const timestamp = report.generatedAt.replaceAll(":", "-").replaceAll(".", "-")
  const json = `${JSON.stringify(report, null, 2)}\n`
  const markdown = `${createMarkdownReport(report)}\n`
  await Promise.all([
    writeFile(resolve(REPORT_DIRECTORY, "latest.json"), json),
    writeFile(resolve(REPORT_DIRECTORY, "latest.md"), markdown),
    writeFile(resolve(REPORT_DIRECTORY, `${timestamp}.json`), json),
    writeFile(resolve(REPORT_DIRECTORY, `${timestamp}.md`), markdown),
  ])
}

function createMarkdownReport(report) {
  const lines = [
    "# Tessera Markdown 编辑器性能基准",
    "",
    `- 时间：${report.generatedAt}`,
    `- 环境：${report.environment.os} / ${report.environment.architecture}`,
    `- CPU：${report.environment.cpu}`,
    `- Electron / Chrome：${report.environment.electron} / ${report.environment.chrome}`,
    `- Renderer working set：${formatNumber(report.environment.rendererWorkingSetMiB)} MiB`,
    `- 预算状态：${report.budget.passed ? "通过" : "超限"}${report.budget.checked ? "（check 模式）" : "（仅报告）"}`,
    "",
    "| 场景 | 字符 / 顶层块 | Markdown 解析 p95 | PM 建树 p95 | 打开到帧 p95 | transaction p95 | 输入到帧 p95 | 序列化 p95 | hover p95 | 滚动帧 p95 | 慢帧率 | 堆增量 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.label} | ${scenario.characterCount} / ${scenario.topLevelBlockCount} | ${formatMs(scenario.markdownParseMs.p95)} | ${formatMs(scenario.documentCreateMs.p95)} | ${formatMs(scenario.openToFrameMs.p95)} | ${formatMs(scenario.transactionMs.p95)} | ${formatMs(scenario.inputToFrameMs.p95)} | ${formatMs(scenario.serializeMs.p95)} | ${formatMs(scenario.hoverToFrameMs.p95)} | ${formatMs(scenario.scrollFrameMs.p95)} | ${formatPercent(scenario.slowFrameRate)} | ${formatNumber(scenario.heapDeltaMiB)} MiB |`,
    )
  }

  if (report.budget.violations.length > 0) {
    lines.push("", "## 超出预算", "")
    for (const violation of report.budget.violations) {
      lines.push(
        `- ${violation.scenarioId} / ${violation.metric}：${formatNumber(violation.actual)} > ${formatNumber(violation.maximum)}`,
      )
    }
  }

  lines.push(
    "",
    "> `transaction` 是同步 ProseMirror transaction；`输入到帧`包含该 transaction 到下一 animation frame 的总时间。",
  )
  return lines.join("\n")
}

function formatMs(value) {
  return `${formatNumber(value)} ms`
}

function formatNumber(value) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(2)
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`
}

function round(value) {
  return Number(value.toFixed(3))
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`编辑器基准超过 ${timeoutMs}ms。`)), timeoutMs)
    }),
  ])
}
