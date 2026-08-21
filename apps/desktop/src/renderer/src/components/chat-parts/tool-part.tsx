/**
 * [INPUT]: AI SDK dynamic-tool 或 tool-* Part、Agent 变更预览与工具审批回调
 * [OUTPUT]: 工作区/联网/子 Agent 工具状态、通用确认，以及 Markdown 写工具的高亮 Diff 审批
 * [POS]: ChatMessage 内可独立演进的工具呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import type { AgentChangePreview } from "@tessera/contracts"
import { TaskAdd01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { AgentChangeReview } from "./agent-change-review"

type MessagePart = UIMessage["parts"][number]
type ToolMessagePart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

interface ToolPartProps {
  loadAgentChangePreview?: ((approvalId: string) => Promise<AgentChangePreview>) | undefined
  onOpenDocument?: ((path: string) => void) | undefined
  onToolApproval?: ((approvalId: string, approved: boolean) => void) | undefined
  part: ToolMessagePart
}

const stateLabels: Record<ToolMessagePart["state"], string> = {
  "input-streaming": "正在准备",
  "input-available": "正在执行",
  "approval-requested": "等待授权",
  "approval-responded": "已确认授权",
  "output-available": "已完成",
  "output-error": "执行失败",
  "output-denied": "已拒绝",
}

const toolLabels: Record<string, string> = {
  "list-workspace-files": "列出工作区文件",
  "read-workspace-file": "读取工作区文件",
  "search-workspace-text": "搜索工作区文本",
  "read-current-document": "读取当前文档",
  "write-workspace-document": "修改工作区文档",
  "delegate-workspace-research": "委派工作区研究",
  web_search: "联网搜索",
}

function toolResource(part: ToolMessagePart) {
  if (!("input" in part) || !part.input || typeof part.input !== "object" || Array.isArray(part.input)) {
    return ""
  }
  const input = part.input as Record<string, unknown>
  if (typeof input.path === "string") return input.path
  if (typeof input.directory === "string" && input.directory) return input.directory
  if (typeof input.query === "string") return `“${input.query}”`
  return ""
}

export function isToolPart(part: MessagePart): part is ToolMessagePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

function stateLabel(part: ToolMessagePart) {
  if (part.state === "approval-responded" && part.approval?.approved === false) return "已拒绝"
  if (part.state === "approval-responded" && part.approval?.approved === true) return "已批准"
  return stateLabels[part.state]
}

export function ToolPart({ loadAgentChangePreview, onOpenDocument, onToolApproval, part }: ToolPartProps) {
  const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
  const resource = toolResource(part)
  const busy = part.state === "input-streaming" || part.state === "input-available"
  const errorText = part.state === "output-error" ? part.errorText : ""

  const changeApproval =
    toolName === "write-workspace-document" && part.approval && loadAgentChangePreview ? part.approval : null

  return (
    <div className="my-3" aria-busy={busy}>
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <Icon icon={TaskAdd01Icon} size={14} />
        <span className="min-w-0 flex-1 truncate">
          {part.title || toolLabels[toolName] || toolName}
          {resource ? <span className="ml-1.5 text-muted-foreground/75">· {resource}</span> : null}
        </span>
        <span
          className={`max-w-72 truncate ${part.state === "output-error" ? "text-destructive" : ""}`}
          title={errorText || undefined}
        >
          {stateLabel(part)}
          {errorText ? ` · ${errorText}` : ""}
        </span>
      </div>
      {changeApproval ? (
        <AgentChangeReview
          approvalId={changeApproval.id}
          canDecide={
            part.state === "approval-requested" && !changeApproval.isAutomatic && Boolean(onToolApproval)
          }
          loadPreview={loadAgentChangePreview!}
          onOpenDocument={onOpenDocument}
          onDecision={(approved) => onToolApproval?.(changeApproval.id, approved)}
        />
      ) : part.state === "approval-requested" &&
        part.approval &&
        !part.approval.isAutomatic &&
        onToolApproval ? (
        <div className="mt-2 rounded-xl border border-border bg-background px-3.5 py-3 text-xs">
          <p className="font-medium text-foreground">这个工具需要你的确认</p>
          {part.input !== undefined ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-5 text-muted-foreground">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onToolApproval(part.approval!.id, false)}
            >
              拒绝
            </Button>
            <Button type="button" size="xs" onClick={() => onToolApproval(part.approval!.id, true)}>
              允许执行
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
