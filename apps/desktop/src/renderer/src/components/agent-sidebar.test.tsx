/**
 * [INPUT]: 文档侧边对话容器与宽度边界函数
 * [OUTPUT]: 独立精简 Header、可访问调宽分隔条和响应式最小/最大宽度的回归验证
 * [POS]: agent-sidebar 独立可调宽信息架构的单元测试
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
import {
  AGENT_SIDEBAR_DEFAULT_WIDTH,
  AGENT_SIDEBAR_MAX_WIDTH,
  AGENT_SIDEBAR_MIN_WIDTH,
  AgentSidebar,
  resolveAgentSidebarWidth,
} from "./agent-sidebar"

describe("文档侧边对话布局", () => {
  it("使用自己的精简 Header 与可访问调宽分隔条", () => {
    const markup = renderToStaticMarkup(
      <AgentSidebar onClose={() => undefined}>
        <div>统一任务内容</div>
      </AgentSidebar>,
    )

    expect(markup).toContain('data-slot="agent-sidebar-header"')
    expect(markup).toContain("侧边对话")
    expect(markup).toContain('aria-label="关闭侧边对话"')
    expect(markup).toContain("<hr")
    expect(markup).toContain('aria-label="调整侧边对话宽度"')
    expect(markup).not.toContain("当前任务与项目历史")
    expect(markup).not.toContain('aria-label="新建侧栏任务"')
    expect(markup).toContain("统一任务内容")
  })

  it("在宽屏遵守默认、最小和最大宽度", () => {
    expect(resolveAgentSidebarWidth(Number.NaN, 1600)).toBe(AGENT_SIDEBAR_DEFAULT_WIDTH)
    expect(resolveAgentSidebarWidth(100, 1600)).toBe(AGENT_SIDEBAR_MIN_WIDTH)
    expect(resolveAgentSidebarWidth(1000, 1600)).toBe(AGENT_SIDEBAR_MAX_WIDTH)
  })

  it("分栏布局为编辑器保留空间，窄屏覆盖时只保留窗口边距", () => {
    expect(resolveAgentSidebarWidth(720, 1000)).toBe(480)
    expect(resolveAgentSidebarWidth(720, 800)).toBe(720)
    expect(resolveAgentSidebarWidth(460, 400)).toBe(368)
  })
})
