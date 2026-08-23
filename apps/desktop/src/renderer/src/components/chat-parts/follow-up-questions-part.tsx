/**
 * [INPUT]: 已通过契约校验的 data-follow-up-questions Part 与可选问题选择回调
 * [OUTPUT]: 回答正文下方可点击、不会自动发送的“继续探索”问题列表
 * [POS]: ChatMessage 中最终回答与输入框之间的引申问题呈现单元
 * [DOC]: design.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessagePart } from "@tessera/ai/react"
import { isTaskFollowUpQuestionsDataV1 } from "@tessera/contracts"
import { Button } from "@tessera/design-system/components/ui/button"
import React from "react"

export type FollowUpQuestionsPartValue = Extract<UIMessagePart, { type: "data-follow-up-questions" }>

export function isFollowUpQuestionsPart(part: UIMessagePart): part is FollowUpQuestionsPartValue {
  return part.type === "data-follow-up-questions" && isTaskFollowUpQuestionsDataV1(part.data)
}

export function FollowUpQuestionsPart({
  part,
  onSelect,
}: Readonly<{
  part: FollowUpQuestionsPartValue
  onSelect?: ((prompt: string) => void) | undefined
}>) {
  if (!isTaskFollowUpQuestionsDataV1(part.data)) return null
  return (
    <section className="mt-5" aria-label="继续探索">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">继续探索</p>
      <div className="flex flex-col items-start gap-1.5">
        {part.data.questions.map((question) => (
          <Button
            key={question.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto max-w-full justify-start whitespace-normal py-2 text-left text-xs leading-5"
            disabled={!onSelect}
            onClick={() => onSelect?.(question.prompt)}
          >
            {question.prompt}
          </Button>
        ))}
      </div>
    </section>
  )
}
