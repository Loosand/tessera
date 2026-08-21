/**
 * [INPUT]: request-user-input 的 AI SDK Tool Part 与类型化 tool output 回调
 * [OUTPUT]: 可恢复的单选、多选、文本与跳过交互，以及回答后的紧凑确认摘要
 * [POS]: ChatMessage 中专门处理 Agent 暂停并等待用户回答的客户端工具界面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import {
  REQUEST_USER_INPUT_TOOL_NAME,
  type TaskUserInputAnswer,
  type TaskUserInputOption,
  type TaskUserInputQuestion,
  type TaskUserInputRequest,
  type TaskUserInputResult,
} from "@tessera/contracts"
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Message01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { useMemo, useState } from "react"

type MessagePart = UIMessage["parts"][number]
export type UserInputToolPart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

type DraftAnswer = {
  readonly customText: string
  readonly optionIds: readonly string[]
  readonly text: string
}

type UserInputPartProps = {
  readonly onSubmit?:
    | ((toolCallId: string, output: TaskUserInputResult) => void | PromiseLike<void>)
    | undefined
  readonly part: UserInputToolPart
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolName(part: UserInputToolPart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
}

function isOption(value: unknown): value is TaskUserInputOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.description === undefined || typeof value.description === "string")
  )
}

function isQuestion(value: unknown): value is TaskUserInputQuestion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.prompt !== "string" ||
    (value.kind !== "single" && value.kind !== "multiple" && value.kind !== "text") ||
    (value.required !== undefined && typeof value.required !== "boolean") ||
    (value.allowCustom !== undefined && typeof value.allowCustom !== "boolean")
  ) {
    return false
  }
  if (value.kind === "text") return value.options === undefined
  return Array.isArray(value.options) && value.options.length >= 2 && value.options.every(isOption)
}

export function parseTaskUserInputRequest(value: unknown): TaskUserInputRequest | null {
  if (
    !isRecord(value) ||
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.description !== undefined && typeof value.description !== "string") ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1
  ) {
    return null
  }

  const questions = value.questions.filter(isQuestion)
  if (questions.length !== value.questions.length) return null

  return {
    questions,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  }
}

function parseTaskUserInputResult(value: unknown): TaskUserInputResult | null {
  if (!isRecord(value)) return null
  if (value.status === "skipped" || value.status === "dismissed") return { status: value.status }
  if (value.status !== "answered" || !Array.isArray(value.answers)) return null
  const answers: TaskUserInputAnswer[] = []
  for (const answer of value.answers) {
    if (
      !isRecord(answer) ||
      typeof answer.questionId !== "string" ||
      (answer.optionIds !== undefined &&
        (!Array.isArray(answer.optionIds) || !answer.optionIds.every((id) => typeof id === "string"))) ||
      (answer.text !== undefined && typeof answer.text !== "string")
    ) {
      return null
    }
    answers.push({
      questionId: answer.questionId,
      ...(answer.optionIds ? { optionIds: answer.optionIds } : {}),
      ...(answer.text ? { text: answer.text } : {}),
    })
  }
  return { status: "answered", answers }
}

export function isUserInputToolPart(part: MessagePart): part is UserInputToolPart {
  if (!isToolMessagePart(part)) return false
  return toolName(part) === REQUEST_USER_INPUT_TOOL_NAME
}

function isToolMessagePart(part: MessagePart): part is UserInputToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

function emptyDraft(): DraftAnswer {
  return { customText: "", optionIds: [], text: "" }
}

function answerLabel(question: TaskUserInputQuestion, answer: TaskUserInputAnswer) {
  const labels = (question.options ?? [])
    .filter((option) => answer.optionIds?.includes(option.id))
    .map((option) => option.label)
  if (answer.text) labels.push(answer.text)
  return labels.join("、") || "未填写"
}

type AnsweredSummaryProps = {
  readonly input: TaskUserInputRequest
  readonly output: TaskUserInputResult
}

function AnsweredSummary({ input, output }: AnsweredSummaryProps) {
  if (output.status !== "answered") {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <Icon icon={CheckmarkCircle02Icon} size={14} />
        <span>{output.status === "skipped" ? "用户跳过了这组问题" : "用户关闭了这组问题"}</span>
      </div>
    )
  }

  return (
    <details className="my-3 rounded-xl border border-border bg-background px-3.5 py-3 text-xs">
      <summary className="cursor-pointer list-none font-medium text-foreground">
        <span className="inline-flex items-center gap-2">
          <Icon icon={CheckmarkCircle02Icon} size={14} />
          已确认 · {output.answers.length} 项回答
        </span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {output.answers.map((answer) => {
          const question = input.questions.find((candidate) => candidate.id === answer.questionId)
          return question ? (
            <div key={answer.questionId} className="grid gap-1 sm:grid-cols-[minmax(8rem,0.7fr)_1fr]">
              <span className="text-muted-foreground">{question.prompt}</span>
              <span className="font-medium text-foreground">{answerLabel(question, answer)}</span>
            </div>
          ) : null
        })}
      </div>
    </details>
  )
}

export function UserInputPart({ onSubmit, part }: UserInputPartProps) {
  const input = "input" in part ? parseTaskUserInputRequest(part.input) : null
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({})
  const [submitting, setSubmitting] = useState(false)

  const completedOutput = part.state === "output-available" ? parseTaskUserInputResult(part.output) : null
  const valid = useMemo(() => {
    if (!input) return false
    const hasAnswer = (question: TaskUserInputQuestion) => {
      const draft = drafts[question.id] ?? emptyDraft()
      if (question.kind === "text") return Boolean(draft.text.trim())
      return draft.optionIds.length > 0 || Boolean(draft.customText.trim())
    }
    return (
      input.questions.every((question) => question.required === false || hasAnswer(question)) &&
      input.questions.some(hasAnswer)
    )
  }, [drafts, input])

  if (input && completedOutput) return <AnsweredSummary input={input} output={completedOutput} />

  if (!input) {
    return (
      <div className="my-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        {part.state === "input-streaming" ? "正在准备需要确认的问题…" : "问题格式无效，无法显示。"}
      </div>
    )
  }

  const updateDraft = (questionId: string, update: Partial<DraftAnswer>) => {
    setDrafts((current) => ({
      ...current,
      [questionId]: { ...(current[questionId] ?? emptyDraft()), ...update },
    }))
  }

  const submit = async (output: TaskUserInputResult) => {
    if (!onSubmit || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(part.toolCallId, output)
    } finally {
      setSubmitting(false)
    }
  }

  const submitAnswers = () => {
    if (!valid) return
    const answers = input.questions.flatMap((question) => {
      const draft = drafts[question.id] ?? emptyDraft()
      const text = question.kind === "text" ? draft.text.trim() : draft.customText.trim()
      if (question.required === false && draft.optionIds.length === 0 && !text) return []
      return [
        {
          questionId: question.id,
          ...(draft.optionIds.length > 0 ? { optionIds: [...draft.optionIds] } : {}),
          ...(text ? { text } : {}),
        },
      ] satisfies TaskUserInputAnswer[]
    })
    void submit({ status: "answered", answers })
  }

  return (
    <section
      className="my-3 rounded-2xl border border-border bg-background p-4 shadow-sm"
      aria-busy={submitting}
      aria-label="等待你的回答"
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 text-muted-foreground" icon={Message01Icon} size={15} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{input.title || "需要你确认一下"}</h3>
          {input.description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{input.description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="关闭问题并继续任务"
          title="关闭"
          disabled={!onSubmit || submitting}
          onClick={() => void submit({ status: "dismissed" })}
        >
          <Icon icon={CancelCircleIcon} size={14} />
        </Button>
      </div>

      <div className="mt-4 space-y-4">
        {input.questions.map((question, questionIndex) => {
          const draft = drafts[question.id] ?? emptyDraft()
          return (
            <fieldset key={question.id} className="min-w-0">
              <legend className="mb-2 text-[13px] font-medium text-foreground">
                <span className="mr-1.5 text-muted-foreground">{questionIndex + 1}.</span>
                {question.prompt}
                {question.required === false ? (
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">可选</span>
                ) : null}
              </legend>

              {question.kind === "text" ? (
                <textarea
                  className="min-h-20 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-[13px] leading-5 outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  value={draft.text}
                  placeholder="输入你的回答…"
                  onChange={(event) => updateDraft(question.id, { text: event.target.value })}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {question.options?.map((option) => {
                    const selected = draft.optionIds.includes(option.id)
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        className={`rounded-full border px-3 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                          selected
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-background text-foreground hover:bg-muted"
                        }`}
                        title={option.description}
                        onClick={() =>
                          updateDraft(question.id, {
                            optionIds:
                              question.kind === "single"
                                ? [option.id]
                                : selected
                                  ? draft.optionIds.filter((id) => id !== option.id)
                                  : [...draft.optionIds, option.id],
                          })
                        }
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              )}

              {question.kind !== "text" && question.allowCustom ? (
                <input
                  className="mt-2 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  value={draft.customText}
                  placeholder="其他，补充你的想法…"
                  onChange={(event) => updateDraft(question.id, { customText: event.target.value })}
                />
              ) : null}
            </fieldset>
          )
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">回答后任务会自动继续</span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!onSubmit || submitting}
            onClick={() => void submit({ status: "skipped" })}
          >
            跳过
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={!onSubmit || !valid || submitting}
            onClick={submitAnswers}
          >
            {submitting ? "正在提交" : "继续任务"}
          </Button>
        </div>
      </div>
    </section>
  )
}
