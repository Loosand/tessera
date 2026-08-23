/**
 * [INPUT]: 任务分页控件与 React 静态渲染器
 * [OUTPUT]: 页码、总数和首尾翻页禁用语义的回归验证
 * [POS]: 任务分页产品模式的轻量组件测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TaskPaginationControls } from "./task-pagination-controls"

describe("任务分页控件", () => {
  it("呈现总数并在第一页禁用上一页", () => {
    const markup = renderToStaticMarkup(
      <TaskPaginationControls page={1} total={23} totalPages={2} onPageChange={() => undefined} />,
    )

    expect(markup).toContain("第 1 / 2 页 · 共 23 个任务")
    expect(markup).toContain('aria-label="上一页任务"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-label="下一页任务"')
  })
})
