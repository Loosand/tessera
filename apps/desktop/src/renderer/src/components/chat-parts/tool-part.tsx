/**
 * [INPUT]: AI SDK dynamic-tool 或 tool-* Part
 * [OUTPUT]: 工具调用的输入、执行、完成、拒绝与错误状态
 * [POS]: ChatMessage 内可独立演进的工具呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { TaskAdd01Icon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"

type MessagePart = UIMessage["parts"][number]
type ToolMessagePart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

interface ToolPartProps {
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

export function isToolPart(part: MessagePart): part is ToolMessagePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

export function ToolPart({ part }: ToolPartProps) {
  const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
  const busy = part.state === "input-streaming" || part.state === "input-available"

  return (
    <div
      className="my-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
      aria-busy={busy}
    >
      <Icon icon={TaskAdd01Icon} size={14} />
      <span className="min-w-0 flex-1 truncate">{part.title || toolName}</span>
      <span className={part.state === "output-error" ? "text-destructive" : undefined}>
        {stateLabels[part.state]}
      </span>
    </div>
  )
}
