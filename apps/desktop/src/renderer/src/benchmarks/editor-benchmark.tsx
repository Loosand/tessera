/**
 * [INPUT]: 固定 Markdown 语料、Tessera TipTap schema、React 编辑表面与浏览器性能 API
 * [OUTPUT]: 解析、挂载、输入、序列化、区块 hover、滚动和内存的结构化基准报告
 * [POS]: 生产 Electron 渲染进程内的编辑器性能采集器
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Editor, getSchema } from "@tiptap/core"
import { MarkdownManager } from "@tiptap/markdown"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import { EditorContent } from "@tiptap/react"
import { flushSync } from "react-dom"
import { type Root, createRoot } from "react-dom/client"
import { EDITOR_EXTENSIONS } from "../components/editor/editor-extensions"
import { TopLevelBlockHandle } from "../components/editor/top-level-block-handle"
import { createEditorBenchmarkScenarios } from "./editor-benchmark-corpus"

interface MemorySnapshot {
  jsHeapSizeLimit: number
  totalJSHeapSize: number
  usedJSHeapSize: number
}

interface BenchmarkPerformance extends Performance {
  memory?: MemorySnapshot
}

interface BenchmarkNavigator extends Navigator {
  deviceMemory?: number
}

interface BenchmarkGlobal {
  gc?: () => void
}

export interface MetricSummary {
  max: number
  median: number
  min: number
  p95: number
  samples: number[]
}

export interface EditorScenarioMetrics {
  characterCount: number
  complexNodeCount: number
  documentCreateMs: MetricSummary
  domNodeCount: number
  heapDeltaMiB: number | null
  hoverToFrameMs: MetricSummary
  id: string
  inputToFrameMs: MetricSummary
  label: string
  markdownParseMs: MetricSummary
  nodeCount: number
  openToFrameMs: MetricSummary
  parseMs: MetricSummary
  scrollDistancePx: number
  scrollFrameMs: MetricSummary
  serializeMs: MetricSummary
  slowFrameRate: number
  topLevelBlockCount: number
  transactionMs: MetricSummary
}

export interface EditorBenchmarkReport {
  environment: {
    deviceMemoryGiB: number | null
    hardwareConcurrency: number
    userAgent: string
    viewport: {
      devicePixelRatio: number
      height: number
      width: number
    }
  }
  generatedAt: string
  scenarios: EditorScenarioMetrics[]
  suite: "tessera-markdown-editor"
  version: 1
}

interface MountedEditor {
  editor: Editor
  reactRoot: Root
  viewport: HTMLElement
}

const markdownManager = new MarkdownManager({
  extensions: EDITOR_EXTENSIONS,
  markedOptions: { breaks: false, gfm: true },
})
const editorSchema = getSchema(EDITOR_EXTENSIONS)
const COMPLEX_NODE_NAMES = new Set([
  "blockquote",
  "bulletList",
  "codeBlock",
  "heading",
  "horizontalRule",
  "orderedList",
  "table",
  "tableCell",
  "tableHeader",
  "tableRow",
  "taskItem",
  "taskList",
])

export async function runEditorBenchmark(root: HTMLElement): Promise<EditorBenchmarkReport> {
  const scenarios: EditorScenarioMetrics[] = []
  document.title = "Tessera Editor Benchmark"

  for (const scenario of createEditorBenchmarkScenarios()) {
    showStatus(root, `正在测量：${scenario.label}`)
    console.info(`[editor-benchmark] 开始 ${scenario.id}`)
    scenarios.push(await measureScenario(root, scenario.id, scenario.label, scenario.markdown))
    console.info(`[editor-benchmark] 完成 ${scenario.id}`)
  }

  const report: EditorBenchmarkReport = {
    environment: {
      deviceMemoryGiB: (navigator as BenchmarkNavigator).deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
      viewport: {
        devicePixelRatio: window.devicePixelRatio,
        height: window.innerHeight,
        width: window.innerWidth,
      },
    },
    generatedAt: new Date().toISOString(),
    scenarios,
    suite: "tessera-markdown-editor",
    version: 1,
  }

  showStatus(root, "基准完成，正在写入报告。")
  return report
}

async function measureScenario(
  root: HTMLElement,
  id: string,
  label: string,
  markdown: string,
): Promise<EditorScenarioMetrics> {
  collectGarbage()
  const heapBefore = readUsedHeapMiB()
  const parsing = measureMarkdownParsing(markdown)
  const { document } = parsing
  const documentShape = inspectDocument(document)

  const warmup = await mountEditor(root, markdown)
  cleanupMountedEditor(warmup)
  await nextFrame()

  const openSamples: number[] = []
  let mounted: MountedEditor | null = null
  for (let index = 0; index < 3; index += 1) {
    const startedAt = performance.now()
    const nextMounted = await mountEditor(root, markdown)
    openSamples.push(performance.now() - startedAt)
    if (mounted) cleanupMountedEditor(mounted)
    mounted = nextMounted
    if (index < 2) {
      cleanupMountedEditor(nextMounted)
      mounted = null
      await nextFrame()
    }
  }
  if (!mounted) throw new Error(`无法挂载基准编辑器：${id}`)

  const { editor, viewport } = mounted
  const transactionSamples: number[] = []
  const inputToFrameSamples: number[] = []
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
  editor.view.focus()
  await nextFrame()

  for (let index = 0; index < 24; index += 1) {
    const startedAt = performance.now()
    editor.view.dispatch(editor.state.tr.insertText("测"))
    transactionSamples.push(performance.now() - startedAt)
    await nextFrame()
    inputToFrameSamples.push(performance.now() - startedAt)
  }

  const serializeMs = measureSync(() => editor.getMarkdown(), 1, 7)
  const hoverToFrameMs = await measureBlockHover(editor, viewport)
  const scrollMetrics = await measureScroll(viewport)
  const domNodeCount = editor.view.dom.querySelectorAll("*").length
  collectGarbage()
  const heapAfter = readUsedHeapMiB()
  const heapDeltaMiB = heapBefore === null || heapAfter === null ? null : Math.max(0, heapAfter - heapBefore)

  cleanupMountedEditor(mounted)
  root.replaceChildren()
  collectGarbage()
  await nextFrame()

  return {
    characterCount: markdown.length,
    complexNodeCount: documentShape.complexNodeCount,
    documentCreateMs: parsing.documentCreateMs,
    domNodeCount,
    heapDeltaMiB: heapDeltaMiB === null ? null : round(heapDeltaMiB),
    hoverToFrameMs,
    id,
    inputToFrameMs: summarize(inputToFrameSamples),
    label,
    markdownParseMs: parsing.markdownParseMs,
    nodeCount: documentShape.nodeCount,
    openToFrameMs: summarize(openSamples),
    parseMs: parsing.totalMs,
    scrollDistancePx: round(scrollMetrics.distance),
    scrollFrameMs: summarize(scrollMetrics.frameIntervals),
    serializeMs,
    slowFrameRate: round(scrollMetrics.slowFrameRate),
    topLevelBlockCount: document.childCount,
    transactionMs: summarize(transactionSamples),
  }
}

function measureMarkdownParsing(markdown: string) {
  editorSchema.nodeFromJSON(markdownManager.parse(markdown))
  const markdownParseSamples: number[] = []
  const documentCreateSamples: number[] = []
  const totalSamples: number[] = []
  let document: ProseMirrorNode | null = null

  for (let index = 0; index < 7; index += 1) {
    const totalStartedAt = performance.now()
    const markdownStartedAt = performance.now()
    const json = markdownManager.parse(markdown)
    markdownParseSamples.push(performance.now() - markdownStartedAt)

    const documentStartedAt = performance.now()
    document = editorSchema.nodeFromJSON(json)
    documentCreateSamples.push(performance.now() - documentStartedAt)
    totalSamples.push(performance.now() - totalStartedAt)
  }

  if (!document) throw new Error("Markdown 性能语料未生成 ProseMirror 文档。")
  return {
    document,
    documentCreateMs: summarize(documentCreateSamples),
    markdownParseMs: summarize(markdownParseSamples),
    totalMs: summarize(totalSamples),
  }
}

function inspectDocument(document: ProseMirrorNode) {
  let complexNodeCount = 0
  let nodeCount = 1
  document.descendants((node) => {
    nodeCount += 1
    if (COMPLEX_NODE_NAMES.has(node.type.name)) complexNodeCount += 1
  })
  return { complexNodeCount, nodeCount }
}

async function mountEditor(root: HTMLElement, markdown: string): Promise<MountedEditor> {
  const host = document.createElement("div")
  host.style.height = "100%"
  root.replaceChildren(host)

  const editor = new Editor({
    content: markdown,
    contentType: "markdown",
    editorProps: {
      attributes: {
        "aria-label": "Markdown 编辑器性能基准",
        class: "typeset typeset-editor rich-text-content",
      },
    },
    extensions: EDITOR_EXTENSIONS,
  })
  const reactRoot = createRoot(host)
  flushSync(() => {
    reactRoot.render(<BenchmarkEditorSurface editor={editor} />)
  })
  await nextFrame()
  await nextFrame()

  const viewport = host.querySelector<HTMLElement>("[data-editor-benchmark-viewport]")
  if (!viewport) {
    reactRoot.unmount()
    editor.destroy()
    throw new Error("编辑器基准缺少滚动视口。")
  }
  return { editor, reactRoot, viewport }
}

function BenchmarkEditorSurface({ editor }: { editor: Editor }) {
  return (
    <div
      data-editor-benchmark-viewport
      style={{
        contain: "layout paint style",
        height: "720px",
        overflow: "auto",
        width: "100%",
      }}
    >
      <EditorContent editor={editor} />
      <TopLevelBlockHandle active editor={editor} />
    </div>
  )
}

function cleanupMountedEditor({ editor, reactRoot }: MountedEditor) {
  flushSync(() => reactRoot.unmount())
  editor.destroy()
}

async function measureBlockHover(editor: Editor, viewport: HTMLElement) {
  viewport.scrollTop = 0
  await nextFrame()
  const blocks = Array.from(editor.view.dom.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  const targets = blocks.slice(0, 2)
  if (targets.length === 0) return summarize([0])

  const samples: number[] = []
  for (let index = 0; index < 20; index += 1) {
    const target = targets[index % targets.length]
    if (!target) continue
    const rect = target.getBoundingClientRect()
    const startedAt = performance.now()
    editor.view.dom.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + Math.min(24, Math.max(4, rect.width / 3)),
        clientY: rect.top + Math.min(12, Math.max(2, rect.height / 2)),
        pointerId: 1,
      }),
    )
    await nextFrame()
    samples.push(performance.now() - startedAt)
  }
  return summarize(samples)
}

async function measureScroll(viewport: HTMLElement) {
  viewport.scrollTop = 0
  await nextFrame()
  await nextFrame()

  const distance = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  const frameIntervals: number[] = []
  let previousFrame = performance.now()
  const frameCount = 60

  for (let frame = 1; frame <= frameCount; frame += 1) {
    viewport.scrollTop = (distance * frame) / frameCount
    await nextFrame()
    const currentFrame = performance.now()
    frameIntervals.push(currentFrame - previousFrame)
    previousFrame = currentFrame
  }

  const slowFrames = frameIntervals.filter((duration) => duration > 25).length
  return {
    distance,
    frameIntervals,
    slowFrameRate: slowFrames / frameIntervals.length,
  }
}

function measureSync(task: () => unknown, warmupCount: number, sampleCount: number) {
  for (let index = 0; index < warmupCount; index += 1) task()
  const samples: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const startedAt = performance.now()
    task()
    samples.push(performance.now() - startedAt)
  }
  return summarize(samples)
}

function summarize(samples: number[]): MetricSummary {
  const sorted = samples.map(round).sort((left, right) => left - right)
  if (sorted.length === 0) throw new Error("性能指标缺少样本。")
  return {
    max: sorted.at(-1) ?? 0,
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? 0,
    p95: percentile(sorted, 0.95),
    samples: sorted,
  }
}

function percentile(sorted: number[], percentileValue: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1))
  return sorted[index] ?? 0
}

function readUsedHeapMiB() {
  const memory = (performance as BenchmarkPerformance).memory
  return memory ? memory.usedJSHeapSize / 1024 / 1024 : null
}

function collectGarbage() {
  ;(globalThis as typeof globalThis & BenchmarkGlobal).gc?.()
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function round(value: number) {
  return Number(value.toFixed(3))
}

function showStatus(root: HTMLElement, message: string) {
  const status = document.createElement("p")
  status.style.cssText =
    "margin:0;padding:24px;color:CanvasText;background:Canvas;font:13px/1.5 ui-monospace,monospace"
  status.textContent = message
  root.replaceChildren(status)
}
