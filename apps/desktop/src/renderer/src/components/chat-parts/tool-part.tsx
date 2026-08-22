/**
 * [INPUT]: AI SDK dynamic-tool 或 tool-* Part、Agent 变更预览、内容领域操作与工具审批回调
 * [OUTPUT]: Tool Chips 工具状态、内容库创建/移动的紧凑确认，以及 Markdown 写工具的高亮 Diff 审批
 * [POS]: ChatMessage 内可独立演进的工具呈现单元
 * [DOC]: design.md、docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import type { AgentChangePreview } from "@tessera/contracts"
import { TaskAdd01Icon } from "@tessera/design-system/components/icons"
import { ToolChips } from "@tessera/design-system/components/tool-chips"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"
import { AgentChangeReview } from "./agent-change-review"

type MessagePart = UIMessage["parts"][number]
type ToolMessagePart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

type ToolPartProps = {
  readonly loadAgentChangePreview?: ((approvalId: string) => Promise<AgentChangePreview>) | undefined
  readonly onOpenDocument?: ((path: string) => void) | undefined
  readonly onToolApproval?: ((approvalId: string, approved: boolean) => void) | undefined
  readonly part: ToolMessagePart
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
  "list-projects": "查看内容库项目",
  "list-task-artifacts": "查看当前任务产物",
  "inspect-project": "检查项目结构",
  "create-document": "创建正式文档",
  "create-project": "创建独立项目",
  "move-documents": "移动正式文档",
  web_search: "联网搜索",
}

const maxToolInputLength = 1_600

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolResource(part: ToolMessagePart) {
  if (!("input" in part) || !isUnknownRecord(part.input)) return ""
  const input = part.input
  if (typeof input.path === "string") return input.path
  if (typeof input.directory === "string" && input.directory) return input.directory
  if (typeof input.query === "string") return `“${input.query}”`
  return ""
}

function toolInputText(part: ToolMessagePart) {
  if (!("input" in part) || part.input === undefined) return ""

  try {
    const serialized = typeof part.input === "string" ? part.input : JSON.stringify(part.input, null, 2)
    if (!serialized) return ""
    if (serialized.length <= maxToolInputLength) return serialized
    return `${serialized.slice(0, maxToolInputLength)}\n…内容过长，已截断`
  } catch {
    return String(part.input)
  }
}

function approvalPresentation(toolName: string, input: unknown) {
  if (!isUnknownRecord(input)) {
    return {
      title: "这个工具需要你的确认",
      detail: input === undefined ? "" : typeof input === "string" ? input : JSON.stringify(input, null, 2),
    }
  }
  if (toolName === "create-document") {
    const title = typeof input.title === "string" ? input.title : "未命名文档"
    const content = typeof input.content === "string" ? input.content : ""
    return {
      title: `创建正式文档「${title}」`,
      meta: `${input.projectId ? "指定项目" : "未归档"} · ${content.length.toLocaleString("zh-CN")} 字符`,
      detail: content.length > 1_000 ? `${content.slice(0, 1_000)}\n\n…正文预览已截断` : content,
    }
  }
  if (toolName === "create-project") {
    return {
      title: `创建独立项目「${typeof input.name === "string" ? input.name : "未命名项目"}」`,
      meta: "将在托管内容库内创建可见目录",
      detail: "",
    }
  }
  if (toolName === "move-documents") {
    const count = Array.isArray(input.documentIds) ? input.documentIds.length : 0
    return {
      title: `移动 ${count} 篇正式文档`,
      meta: "已预检目标项目与同名冲突；不会覆盖文件",
      detail: "",
    }
  }
  return { title: "这个工具需要你的确认", detail: JSON.stringify(input, null, 2) }
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
  const errorText = part.state === "output-error" ? part.errorText : ""
  const inputText = toolInputText(part)
  const details =
    inputText || errorText ? (
      <div className="space-y-2">
        {inputText ? (
          <div>
            <p className="mb-1 font-medium text-foreground/75">工具输入</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-code-background px-3 py-2 font-mono text-[10px] leading-5 text-code-foreground">
              {inputText}
            </pre>
          </div>
        ) : null}
        {errorText ? <p className="text-destructive">{errorText}</p> : null}
      </div>
    ) : undefined

  const changeApproval =
    toolName === "write-workspace-document" && part.approval && loadAgentChangePreview ? part.approval : null
  const manualApproval =
    part.state === "approval-requested" && part.approval && !part.approval.isAutomatic && onToolApproval
      ? part.approval
      : null
  const manualApprovalPresentation = manualApproval
    ? approvalPresentation(toolName, "input" in part ? part.input : undefined)
    : null

  return (
    <div className="my-3">
      <ToolChips
        className="my-0"
        items={[
          {
            defaultExpanded: part.state === "output-error",
            details,
            icon: <Icon icon={TaskAdd01Icon} size={14} />,
            id: part.toolCallId,
            label: part.title || toolLabels[toolName] || toolName,
            meta: resource || undefined,
            status: part.state,
            statusLabel: stateLabel(part),
          },
        ]}
      />
      {changeApproval && loadAgentChangePreview ? (
        <AgentChangeReview
          approvalId={changeApproval.id}
          canDecide={
            part.state === "approval-requested" && !changeApproval.isAutomatic && Boolean(onToolApproval)
          }
          loadPreview={loadAgentChangePreview}
          onOpenDocument={onOpenDocument}
          onDecision={(approved) => onToolApproval?.(changeApproval.id, approved)}
        />
      ) : manualApproval && onToolApproval ? (
        <div className="mt-2 rounded-xl border border-border bg-background px-3.5 py-3 text-xs">
          <p className="font-medium text-foreground">{manualApprovalPresentation?.title}</p>
          {manualApprovalPresentation?.meta ? (
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {manualApprovalPresentation.meta}
            </p>
          ) : null}
          {manualApprovalPresentation?.detail ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-[11px] leading-5 text-muted-foreground">
              {manualApprovalPresentation.detail}
            </pre>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onToolApproval(manualApproval.id, false)}
            >
              拒绝
            </Button>
            <Button type="button" size="xs" onClick={() => onToolApproval(manualApproval.id, true)}>
              允许执行
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
