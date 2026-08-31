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

import {
  type UIMessagePart,
  type UIMessageToolPart,
  isUIMessageToolPart,
  uiMessageToolName,
} from "@tessera/ai/react"
import {
  PUBLISH_RESEARCH_PLAN_TOOL_NAME,
  type TaskResearchPlanInput,
  type TaskResearchQuestion,
} from "@tessera/contracts"
import { ListChecksIcon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"

export type ResearchPlanToolPart = UIMessageToolPart

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isResearchQuestion(value: unknown): value is TaskResearchQuestion {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string"
}

export function parseResearchPlan(value: unknown): TaskResearchPlanInput | null {
  if (
    !isRecord(value) ||
    typeof value.objective !== "string" ||
    (value.scope !== undefined && typeof value.scope !== "string") ||
    (value.deliverable !== undefined && typeof value.deliverable !== "string") ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1
  ) {
    return null
  }

  const questions = value.questions.filter(isResearchQuestion)
  if (questions.length !== value.questions.length) return null

  return {
    objective: value.objective,
    questions,
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
    ...(typeof value.deliverable === "string" ? { deliverable: value.deliverable } : {}),
  }
}

export function isResearchPlanToolPart(part: UIMessagePart): part is ResearchPlanToolPart {
  return isUIMessageToolPart(part) && uiMessageToolName(part) === PUBLISH_RESEARCH_PLAN_TOOL_NAME
}

type ResearchPlanPartProps = {
  readonly part: ResearchPlanToolPart
  readonly streaming: boolean
}

export function ResearchPlanPart({ part, streaming }: ResearchPlanPartProps) {
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
    <details open className="my-4 overflow-hidden rounded-[18px] bg-muted/55 text-xs" aria-busy={busy}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 font-semibold text-foreground">
        <Icon icon={ListChecksIcon} size={15} />
        <span className="flex-1">研究计划</span>
        <span className="font-normal text-muted-foreground">
          {busy ? "研究中" : `${input.questions.length} 个问题`}
        </span>
      </summary>
      <div className="border-t border-border/40 px-4 py-3.5">
        <p className="font-medium leading-5 text-foreground">{input.objective}</p>
        {input.scope ? <p className="mt-1 leading-5 text-muted-foreground">范围：{input.scope}</p> : null}
        {input.deliverable ? (
          <p className="mt-1 leading-5 text-muted-foreground">交付：{input.deliverable}</p>
        ) : null}
        <ol className="mt-3 space-y-1.5">
          {input.questions.map((question, index) => (
            <li key={question.id} className="flex gap-2 rounded-xl bg-background/70 px-3 py-2.5 leading-5">
              <span className="shrink-0 font-mono text-muted-foreground">Q{index + 1}</span>
              <span className="text-foreground">{question.title}</span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}
