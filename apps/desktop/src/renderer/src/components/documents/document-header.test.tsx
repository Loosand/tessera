/**
 * [INPUT]: 文档 Header 在侧边对话关闭/打开状态下的服务端渲染结果
 * [OUTPUT]: 右栏图形开关、无设置按钮和可访问状态文案的回归验证
 * [POS]: document-header 文档操作与辅助面板边界的单元测试
 * [DOC]: design.md、docs/architecture/editor.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DocumentHeader } from "./document-header"

function renderHeader(agentOpen: boolean) {
  return renderToStaticMarkup(
    <DocumentHeader
      agentOpen={agentOpen}
      canGoBack={false}
      canGoForward={false}
      document={null}
      mode="rich"
      saveStatus="idle"
      sidebarOpen
      workspace={null}
      onGoBack={() => undefined}
      onGoForward={() => undefined}
      onModeChange={() => undefined}
      onRenameDocument={() => Promise.resolve(false)}
      onToggleAgent={() => undefined}
      onToggleSidebar={() => undefined}
    />,
  )
}

describe("文档 Header 辅助面板入口", () => {
  it("只提供侧边对话开关，不重复放置设置入口", () => {
    const closedMarkup = renderHeader(false)
    const openMarkup = renderHeader(true)

    expect(closedMarkup).toContain('aria-label="打开侧边对话"')
    expect(openMarkup).toContain('aria-label="关闭侧边对话"')
    expect(openMarkup).toContain('aria-pressed="true"')
    expect(closedMarkup).not.toContain('aria-label="打开设置"')
    expect(openMarkup).not.toContain('aria-label="打开设置"')
  })
})
