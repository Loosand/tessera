/**
 * [INPUT]: 默认任务输入框的服务端渲染结果
 * [OUTPUT]: 常驻工具栏不暴露 Chat/Agent、专业能力开关和范围长文，并区分模型加载/未配置状态的回归验证
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

function renderComposer({ modelLoading = false, notice = "", scope = "" } = {}) {
  return renderToStaticMarkup(
    <TaskComposer
      agentMode={false}
      agentReady={false}
      availableDocument={null}
      documentContext={null}
      images={[]}
      model={undefined}
      modelLoading={modelLoading}
      models={[]}
      notice={notice}
      onAddImages={() => undefined}
      onAddCurrentDocument={() => undefined}
      onChange={() => undefined}
      onModelChange={() => undefined}
      onRemoveDocumentContext={() => undefined}
      onRemoveImage={() => undefined}
      onSkillChange={() => undefined}
      onStop={() => undefined}
      onSubmit={() => undefined}
      scope={scope}
      selectedModelKey=""
      skillId={null}
      status="ready"
      value=""
    />,
  )
}

describe("任务输入框密度", () => {
  it("只暴露可逐轮切换的自动创作方式，不要求选择运行时和专业能力", () => {
    const markup = renderComposer()

    expect(markup).toContain('aria-label="选择创作方式，当前为自动"')
    expect(markup).not.toContain('aria-label="任务模式"')
    expect(markup).not.toContain("联网搜索")
    expect(markup).not.toContain("思考强度")
    expect(markup).not.toContain("<fieldset")
    expect(markup).not.toContain('type="radio"')
  })

  it("SQLite 快照尚未返回时显示加载状态而不是误报未配置", () => {
    const markup = renderComposer({ modelLoading: true })

    expect(markup).toContain("正在加载模型")
    expect(markup).not.toContain("未配置模型")
  })

  it("把上下文与权限范围收进图标浮层，不在输入框中常驻显示长文", () => {
    const scope = "范围：工作区「未归档」中的 Markdown；写入必须先看 Diff 并批准。"
    const markup = renderComposer({ scope })

    expect(markup).toContain('aria-label="查看上下文与权限"')
    expect(markup).not.toContain(scope)
  })

  it("真实错误仍在输入框内直接显示", () => {
    const notice = "模型连接失败"
    const markup = renderComposer({ notice })

    expect(markup).toContain(notice)
    expect(markup).toContain('aria-live="polite"')
  })
})
