/**
 * [INPUT]: publish-research-plan 的 AI SDK Tool Part 与流式状态
 * [OUTPUT]: 可折叠的研究目标、范围、交付物和编号问题计划
 * [POS]: ChatMessage 中 Research Skill 的结构化计划呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import {
  PUBLISH_RESEARCH_PLAN_TOOL_NAME,
  type TaskResearchPlanInput,
} from "@tessera/contracts"
import { ListChecksIcon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"

type MessagePart = UIMessage["parts"][number]
export type ResearchPlanToolPart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolName(part: ResearchPlanToolPart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
}

export function parseResearchPlan(value: unknown): TaskResearchPlanInput | null {
  if (
    !isRecord(value) ||
    typeof value.objective !== "string" ||
    (value.scope !== undefined && typeof value.scope !== "string") ||
    (value.deliverable !== undefined && typeof value.deliverable !== "string") ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1 ||
    !value.questions.every(
      (question) => isRecord(question) && typeof question.id === "string" && typeof question.title === "string",
    )
  ) {
    return null
  }
  return value as TaskResearchPlanInput
}

export function isResearchPlanToolPart(part: MessagePart): part is ResearchPlanToolPart {
  return (
    (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
    toolName(part as ResearchPlanToolPart) === PUBLISH_RESEARCH_PLAN_TOOL_NAME
  )
}

export function ResearchPlanPart({ part, streaming }: { part: ResearchPlanToolPart; streaming: boolean }) {
  const input = "input" in part ? parseResearchPlan(part.input) : null
  const busy = streaming || part.state === "input-streaming" || part.state === "input-available"

  if (!input) {
    return (
      <div className="my-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        {part.state === "input-streaming" ? "正在制定研究计划…" : "研究计划格式无效，无法显示。"}
      </div>
    )
  }

  return (
    <details
      open
      className="my-3 rounded-2xl border border-border bg-background text-xs"
      aria-busy={busy}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold text-foreground">
        <Icon icon={ListChecksIcon} size={15} />
        <span className="flex-1">研究计划</span>
        <span className="font-normal text-muted-foreground">{busy ? "研究中" : `${input.questions.length} 个问题`}</span>
      </summary>
      <div className="border-t border-border px-4 py-3">
        <p className="font-medium leading-5 text-foreground">{input.objective}</p>
        {input.scope ? <p className="mt-1 leading-5 text-muted-foreground">范围：{input.scope}</p> : null}
        {input.deliverable ? (
          <p className="mt-1 leading-5 text-muted-foreground">交付：{input.deliverable}</p>
        ) : null}
        <ol className="mt-3 space-y-1.5">
          {input.questions.map((question, index) => (
            <li key={question.id} className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 leading-5">
              <span className="shrink-0 font-mono text-muted-foreground">Q{index + 1}</span>
              <span className="text-foreground">{question.title}</span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}
