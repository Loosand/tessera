/**
 * [INPUT]: 默认任务输入框的服务端渲染结果
 * [OUTPUT]: 常驻工具栏保持单值模式选择且不回退为平铺 Tab 的回归验证
 * [POS]: task-composer 信息密度边界的单元测试
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TaskComposer } from "./task-composer"

describe("任务输入框密度", () => {
  it("常驻一个能力入口和单值模式选择，不平铺 Skill 与模式 Tab", () => {
    const markup = renderToStaticMarkup(
      <TaskComposer
        agentReady={false}
        images={[]}
        model={undefined}
        models={[]}
        notice=""
        onAddImages={() => undefined}
        onChange={() => undefined}
        onModelChange={() => undefined}
        onModeChange={() => undefined}
        onReasoningChange={() => undefined}
        onRemoveImage={() => undefined}
        onSkillChange={() => undefined}
        onStop={() => undefined}
        onSubmit={() => undefined}
        onWebSearchChange={() => undefined}
        reasoning="auto"
        scope=""
        mode="chat"
        modeLocked={false}
        selectedModelKey=""
        skillId={null}
        skillLocked={false}
        status="ready"
        value=""
        webSearch={false}
      />,
    )

    expect(markup).toContain('aria-label="打开对话能力，当前为问答"')
    expect(markup).toContain('aria-label="任务模式"')
    expect(markup).not.toContain("<fieldset")
    expect(markup).not.toContain('type="radio"')
  })
})
