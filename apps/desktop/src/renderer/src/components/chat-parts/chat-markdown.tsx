/**
 * [INPUT]: 对话正文或供应商 reasoning 返回的 Markdown 文本、密度、流式光标与工作区引用跳转回调
 * [OUTPUT]: 正文和思考过程共享的安全 Markdown 语义渲染及受限 Markdown 文件链接解析
 * [POS]: chat-parts 内统一 Markdown 视觉与行为的基础呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface ChatMarkdownProps {
  children: string
  className?: string
  compact?: boolean
  onOpenWorkspaceReference?: ((path: string, line?: number) => void) | undefined
  streaming?: boolean
}

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
  return (
    <div
      className={`chat-markdown break-words ${className}`}
      data-streaming={streaming || undefined}
      aria-busy={streaming}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: linkChildren, href, ...props }) => {
            const reference = parseWorkspaceReference(href)
            return (
              <a
                {...props}
                href={href}
                {...(reference && onOpenWorkspaceReference
                  ? {
                      onClick: (event) => {
                        event.preventDefault()
                        onOpenWorkspaceReference(reference.path, reference.line)
                      },
                    }
                  : { target: "_blank", rel: "noreferrer" })}
                className="text-foreground underline underline-offset-3"
              >
                {linkChildren}
              </a>
            )
          },
          blockquote: ({ children: quoteChildren }) => (
            <blockquote
              className={`${compact ? "my-3 pl-3" : "my-4 pl-4"} border-l-2 border-border text-muted-foreground`}
            >
              {quoteChildren}
            </blockquote>
          ),
          code: ({ children: codeChildren, className: codeClassName, ...props }) => (
            <code
              {...props}
              className={`${codeClassName ?? ""} rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-words`}
            >
              {codeChildren}
            </code>
          ),
          h1: ({ children: headingChildren }) => (
            <h1 className={compact ? "mt-5 mb-2 text-base font-semibold" : "mt-7 mb-3 text-xl font-semibold"}>
              {headingChildren}
            </h1>
          ),
          h2: ({ children: headingChildren }) => (
            <h2 className={compact ? "mt-4 mb-2 text-sm font-semibold" : "mt-6 mb-2 text-lg font-semibold"}>
              {headingChildren}
            </h2>
          ),
          h3: ({ children: headingChildren }) => (
            <h3
              className={
                compact ? "mt-4 mb-2 text-[13px] font-semibold" : "mt-5 mb-2 text-base font-semibold"
              }
            >
              {headingChildren}
            </h3>
          ),
          li: ({ children: itemChildren }) => <li className="my-1 pl-1">{itemChildren}</li>,
          ol: ({ children: listChildren }) => (
            <ol className={`${compact ? "my-2 pl-5" : "my-3 pl-6"} list-decimal space-y-1`}>
              {listChildren}
            </ol>
          ),
          p: ({ children: paragraphChildren }) => (
            <p className={`${compact ? "my-2" : "my-3"} first:mt-0 last:mb-0`}>{paragraphChildren}</p>
          ),
          pre: ({ children: preChildren }) => (
            <pre
              className={`${compact ? "my-3 rounded-lg p-3 text-[12px] leading-5" : "my-4 rounded-xl p-4 text-[13px] leading-6"} overflow-x-auto bg-muted [&_code]:bg-transparent [&_code]:p-0`}
            >
              {preChildren}
            </pre>
          ),
          table: ({ children: tableChildren }) => (
            <div className={`${compact ? "my-3" : "my-4"} overflow-x-auto rounded-lg ring-1 ring-border`}>
              <table className="w-full border-collapse text-sm">{tableChildren}</table>
            </div>
          ),
          td: ({ children: cellChildren }) => (
            <td className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} border-t border-border`}>
              {cellChildren}
            </td>
          ),
          th: ({ children: cellChildren }) => (
            <th className={`${compact ? "px-2 py-1.5" : "px-3 py-2"} bg-muted text-left font-medium`}>
              {cellChildren}
            </th>
          ),
          ul: ({ children: listChildren }) => (
            <ul className={`${compact ? "my-2 pl-5" : "my-3 pl-6"} list-disc space-y-1`}>{listChildren}</ul>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
      {streaming ? (
        <span
          className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-pulse bg-current align-baseline"
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}
