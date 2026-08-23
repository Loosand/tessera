/**
 * [INPUT]: 不同状态与选中态的 TaskNavigationRow
 * [OUTPUT]: 右侧安全区、选中背景语义和运行中 loader 的静态回归验证
 * [POS]: 侧栏任务导航共享模式的单元测试
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
import { TaskNavigationRow } from "./task-navigation-row"

describe("TaskNavigationRow", () => {
  it("为当前运行中的对话显示选中语义和 loader", () => {
    const markup = renderToStaticMarkup(
      <TaskNavigationRow active status="running" taskTitle="正在生成的写作任务" />,
    )

    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('data-active="true"')
    expect(markup).toContain('data-running="true"')
    expect(markup).toContain("<output")
    expect(markup).toContain('aria-label="正在生成"')
    expect(markup).toContain("animate-spin")
    expect(markup).toContain("pr-3")
    expect(markup).toContain("ml-1")
  })

  it("完成任务不显示运行中 loader", () => {
    const markup = renderToStaticMarkup(<TaskNavigationRow status="completed" taskTitle="已经完成的任务" />)

    expect(markup).not.toContain('data-running="true"')
    expect(markup).not.toContain('role="status"')
  })
})
