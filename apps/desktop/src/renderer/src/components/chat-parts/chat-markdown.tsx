/**
 * [INPUT]: 对话正文、供应商 reasoning 或 Agent 变更预览的 Markdown、密度、流式状态与工作区引用跳转回调
 * [OUTPUT]: 基于 Streamdown 的安全流式 Markdown，统一提供 GFM、CJK、Shiki、KaTeX、Mermaid、增量修复、动画、控件与工作区引用跳转
 * [POS]: chat-parts 内所有 AI 生成 Markdown 的唯一呈现边界
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import React from "react"
import {
  Streamdown,
  defaultRehypePlugins,
  type AnimateOptions,
  type ControlsConfig,
  type LinkSafetyConfig,
  type MermaidErrorComponentProps,
  type MermaidOptions,
  type PluginConfig,
  type StreamdownTranslations,
} from "streamdown"

type ChatMarkdownProps = {
  readonly children: string
  readonly className?: string
  readonly compact?: boolean
  readonly onOpenWorkspaceReference?: ((path: string, line?: number) => void) | undefined
  readonly streaming?: boolean
}

const CHAT_STREAMDOWN_PLUGINS = Object.freeze({ cjk, code, math, mermaid }) satisfies PluginConfig

// Tessera 明确禁用原始 HTML；保留 Streamdown 的 sanitize，再由默认 urlTransform 拒绝危险协议。
const CHAT_SANITIZE_PLUGIN = defaultRehypePlugins.sanitize
if (!CHAT_SANITIZE_PLUGIN) throw new Error("Streamdown 缺少 Markdown sanitize 插件。")
const CHAT_REHYPE_PLUGINS = [CHAT_SANITIZE_PLUGIN]

const CHAT_STREAMDOWN_CONTROLS = Object.freeze({
  code: { copy: true, download: true },
  image: { download: true },
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
  table: { copy: true, download: true, fullscreen: true },
}) satisfies ControlsConfig

const CHAT_STREAMDOWN_ANIMATION = Object.freeze({
  animation: "blurIn",
  duration: 180,
  easing: "ease-out",
  maxBacklogMs: 260,
  sep: "char",
  stagger: 14,
}) satisfies AnimateOptions

// 工作区 Markdown 引用需要保留相对 href；外链导航由桌面壳的安全 URL 白名单接管，危险协议仍由 Streamdown urlTransform 过滤。
const CHAT_LINK_SAFETY = Object.freeze({ enabled: false }) satisfies LinkSafetyConfig

const CHAT_STREAMDOWN_TRANSLATIONS = Object.freeze({
  close: "关闭",
  copied: "已复制",
  copyCode: "复制代码",
  copyLink: "复制链接",
  copyTable: "复制表格",
  copyTableAsCsv: "复制为 CSV",
  copyTableAsMarkdown: "复制为 Markdown",
  copyTableAsTsv: "复制为 TSV",
  downloadDiagram: "下载图表",
  downloadDiagramAsMmd: "下载 Mermaid 源码",
  downloadDiagramAsPng: "下载 PNG",
  downloadDiagramAsSvg: "下载 SVG",
  downloadFile: "下载文件",
  downloadImage: "下载图片",
  downloadTable: "下载表格",
  downloadTableAsCsv: "下载 CSV",
  downloadTableAsMarkdown: "下载 Markdown",
  exitFullscreen: "退出全屏",
  externalLinkWarning: "即将打开外部链接",
  imageNotAvailable: "图片不可用",
  mermaidFormatMmd: "Mermaid 源码",
  mermaidFormatPng: "PNG 图片",
  mermaidFormatSvg: "SVG 图片",
  openExternalLink: "打开外部链接",
  openLink: "打开链接",
  resetView: "重置视图",
  tableFormatCsv: "CSV",
  tableFormatMarkdown: "Markdown",
  tableFormatTsv: "TSV",
  viewFullscreen: "全屏查看",
  zoomIn: "放大",
  zoomOut: "缩小",
}) satisfies Partial<StreamdownTranslations>

function ChatMermaidError({ retry }: MermaidErrorComponentProps) {
  return (
    <div className="my-4 rounded-xl border border-border bg-muted/60 p-4 text-sm text-muted-foreground">
      <p>图表语法暂时无法解析。</p>
      <button
        type="button"
        className="mt-3 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={retry}
      >
        重试
      </button>
    </div>
  )
}

const CHAT_MERMAID_OPTIONS = Object.freeze({
  config: {
    fontFamily: "var(--font-mono)",
    securityLevel: "strict",
    theme: "neutral",
  },
  errorComponent: ChatMermaidError,
}) satisfies MermaidOptions

export function parseWorkspaceReference(href: string | undefined) {
  if (!href || href.includes("://") || href.startsWith("/") || href.startsWith("#")) return null
  const [encodedPath, fragment] = href.split("#", 2)
  if (!encodedPath) return null
  let path: string
  try {
    path = decodeURIComponent(encodedPath).replace(/^\.\//u, "").split("\\").join("/")
  } catch {
    return null
  }
  if (
    !/\.(?:md|markdown)$/iu.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))
  ) {
    return null
  }
  const lineMatch = /^L(\d+)$/u.exec(fragment ?? "")
  return { path, ...(lineMatch ? { line: Number(lineMatch[1]) } : {}) }
}

export function ChatMarkdown({
  children,
  className = "",
  compact = false,
  onOpenWorkspaceReference,
  streaming = false,
}: ChatMarkdownProps) {
  const handleClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onOpenWorkspaceReference || !(event.target instanceof Element)) return
      const link = event.target.closest<HTMLAnchorElement>('a[data-streamdown="link"]')
      if (!link || !event.currentTarget.contains(link)) return
      const reference = parseWorkspaceReference(link.getAttribute("href") ?? undefined)
      if (!reference) return
      event.preventDefault()
      onOpenWorkspaceReference(reference.path, reference.line)
    },
    [onOpenWorkspaceReference],
  )

  return (
    <div
      className={`chat-markdown break-words ${className}`}
      data-compact={compact || undefined}
      data-streaming={streaming || undefined}
      aria-busy={streaming}
      onClickCapture={handleClickCapture}
    >
      <Streamdown
        animated={CHAT_STREAMDOWN_ANIMATION}
        caret="block"
        codeBlockMaxHeight={420}
        controls={CHAT_STREAMDOWN_CONTROLS}
        dir="auto"
        isAnimating={streaming}
        lineNumbers
        linkSafety={CHAT_LINK_SAFETY}
        mermaid={CHAT_MERMAID_OPTIONS}
        mode={streaming ? "streaming" : "static"}
        parseIncompleteMarkdown={streaming}
        plugins={CHAT_STREAMDOWN_PLUGINS}
        rehypePlugins={CHAT_REHYPE_PLUGINS}
        skipHtml
        tableMaxHeight={360}
        translations={CHAT_STREAMDOWN_TRANSLATIONS}
      >
        {children}
      </Streamdown>
    </div>
  )
}
