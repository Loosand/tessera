/**
 * [INPUT]: AI SDK 单个 text Part 及其流式状态
 * [OUTPUT]: 保留 Part 边界的 Markdown 正文与增量光标
 * [POS]: ChatMessage 内的助手正文呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { ChatMarkdown } from "./chat-markdown"

type TextMessagePart = Extract<UIMessage["parts"][number], { type: "text" }>

interface TextPartProps {
  onOpenWorkspaceReference?: ((path: string, line?: number) => void) | undefined
  part: TextMessagePart
  streaming: boolean
}

export function TextPart({ onOpenWorkspaceReference, part, streaming }: TextPartProps) {
  if (!part.text) return null

  return (
    <ChatMarkdown
      className="text-[15px] leading-7 text-foreground"
      streaming={streaming}
      onOpenWorkspaceReference={onOpenWorkspaceReference}
    >
      {part.text}
    </ChatMarkdown>
  )
}
