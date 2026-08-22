/**
 * [INPUT]: 默认任务输入框的服务端渲染结果
 * [OUTPUT]: 常驻工具栏只保留创作模式入口、不暴露 Chat/Agent 和专业能力开关的回归验证
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
  it("只暴露自动创作模式，不要求选择运行时和专业能力", () => {
    const markup = renderToStaticMarkup(
      <TaskComposer
        agentMode={false}
        agentReady={false}
        availableDocument={null}
        documentContext={null}
        images={[]}
        model={undefined}
        models={[]}
        notice=""
        onAddImages={() => undefined}
        onAddCurrentDocument={() => undefined}
        onChange={() => undefined}
        onModelChange={() => undefined}
        onRemoveDocumentContext={() => undefined}
        onRemoveImage={() => undefined}
        onSkillChange={() => undefined}
        onStop={() => undefined}
        onSubmit={() => undefined}
        scope=""
        selectedModelKey=""
        skillId={null}
        status="ready"
        value=""
      />,
    )

    expect(markup).toContain('aria-label="选择创作模式，当前为自动"')
    expect(markup).not.toContain('aria-label="任务模式"')
    expect(markup).not.toContain("联网搜索")
    expect(markup).not.toContain("思考强度")
    expect(markup).not.toContain("<fieldset")
    expect(markup).not.toContain('type="radio"')
  })
})
