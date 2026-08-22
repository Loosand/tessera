/**
 * [INPUT]: 同一助手消息内的内容领域工具 Part、工具审批与文档打开回调
 * [OUTPUT]: 创建文档、创建项目、移动文档和结构检查的聚合 Operation 活动及原生审批
 * [POS]: ChatMessage 中面向用户对象语义的内容操作时间线
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import type { AgentChangePreview } from "@tessera/contracts"
import {
  FileAddIcon,
  FolderAddIcon,
  FolderOpenIcon,
  FolderTreeIcon,
} from "@tessera/design-system/components/icons"
import { ToolChips, type ToolChipItem } from "@tessera/design-system/components/tool-chips"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"
import { ToolPart } from "./tool-part"

type MessagePart = UIMessage["parts"][number]
type ToolMessagePart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

const contentOperationNames = new Set([
  "create-document",
  "create-project",
  "move-documents",
  "inspect-project",
])

const stateLabels: Record<ToolMessagePart["state"], string> = {
  "input-streaming": "正在准备",
  "input-available": "正在执行",
  "approval-requested": "等待确认",
  "approval-responded": "正在执行",
  "output-available": "已完成",
  "output-error": "未完成",
  "output-denied": "已取消",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolName(part: ToolMessagePart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
}

function isToolMessagePart(part: MessagePart): part is ToolMessagePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

export function isContentOperationToolPart(part: MessagePart): part is ToolMessagePart {
  if (!isToolMessagePart(part)) return false
  return contentOperationNames.has(toolName(part))
}

function inputOf(part: ToolMessagePart) {
  return "input" in part && isRecord(part.input) ? part.input : null
}

function outputOf(part: ToolMessagePart) {
  return part.state === "output-available" && isRecord(part.output) ? part.output : null
}

function projectName(output: Record<string, unknown> | null) {
  const project = output && isRecord(output.project) ? output.project : output
  return project && typeof project.name === "string" ? project.name : ""
}

function operationPresentation(part: ToolMessagePart): {
  icon: typeof FileAddIcon
  label: string
  meta?: string
} {
  const name = toolName(part)
  const input = inputOf(part)
  const output = outputOf(part)
  if (name === "create-document") {
    const title = typeof input?.title === "string" ? input.title : "未命名文档"
    const artifactProject = output && isRecord(output.project) ? projectName(output) : ""
    return {
      icon: FileAddIcon,
      label: `创建文档「${title}」`,
      meta: artifactProject || (input?.projectId ? "指定项目" : "未归档"),
    }
  }
  if (name === "create-project") {
    const nameValue = projectName(output) || (typeof input?.name === "string" ? input.name : "未命名项目")
    return { icon: FolderAddIcon, label: `创建项目「${nameValue}」` }
  }
  if (name === "move-documents") {
    const count = Array.isArray(input?.documentIds) ? input.documentIds.length : 0
    const target = projectName(output)
    return {
      icon: FolderOpenIcon,
      label: `移动${count > 0 ? ` ${count} 篇` : ""}文档${target ? `到「${target}」` : ""}`,
    }
  }
  const inspectedProject = projectName(output)
  const documents = output && Array.isArray(output.documents) ? output.documents.length : null
  return {
    icon: FolderTreeIcon,
    label: inspectedProject ? `检查项目「${inspectedProject}」结构` : "检查项目结构",
    ...(documents === null ? {} : { meta: `${documents} 篇文档` }),
  }
}

function operationDetails(part: ToolMessagePart) {
  if (part.state !== "output-error") return undefined
  return <p className="text-destructive">{part.errorText}</p>
}

function operationItem(part: ToolMessagePart): ToolChipItem {
  const presentation = operationPresentation(part)
  return {
    defaultExpanded: part.state === "output-error",
    details: operationDetails(part),
    icon: <Icon icon={presentation.icon} size={14} />,
    id: part.toolCallId,
    label: presentation.label,
    ...(presentation.meta ? { meta: presentation.meta } : {}),
    status: part.state,
    statusLabel: stateLabels[part.state],
  }
}

function operationSummary(parts: readonly ToolMessagePart[]) {
  if (parts.some((part) => part.state === "approval-requested")) return "内容操作等待确认"
  if (
    parts.some(
      (part) =>
        part.state === "input-streaming" ||
        part.state === "input-available" ||
        part.state === "approval-responded",
    )
  ) {
    return "正在整理内容"
  }
  if (parts.some((part) => part.state === "output-error" || part.state === "output-denied")) {
    return "内容操作未全部完成"
  }
  return `已完成 ${parts.length} 项内容操作`
}

export function ContentOperationPart({
  loadAgentChangePreview,
  onOpenDocument,
  onToolApproval,
  parts,
}: Readonly<{
  loadAgentChangePreview?: ((approvalId: string) => Promise<AgentChangePreview>) | undefined
  onOpenDocument?: ((path: string) => void) | undefined
  onToolApproval?: ((approvalId: string, approved: boolean) => void) | undefined
  parts: readonly ToolMessagePart[]
}>) {
  const completed = parts.every((part) => part.state === "output-available")
  return (
    <div className="my-3">
      <ToolChips
        className="my-0"
        defaultExpanded={!completed}
        items={parts.map(operationItem)}
        summary={operationSummary(parts)}
      />
      {parts.map((part) => (
        <ToolPart
          hideSummary
          key={`${part.toolCallId}-approval`}
          loadAgentChangePreview={loadAgentChangePreview}
          onOpenDocument={onOpenDocument}
          onToolApproval={onToolApproval}
          part={part}
        />
      ))}
    </div>
  )
}
