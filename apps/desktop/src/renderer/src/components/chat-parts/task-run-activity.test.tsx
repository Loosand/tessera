/**
 * [INPUT]: 运行中与已完成的任务活动反馈组件
 * [OUTPUT]: 通用运行文案、闪烁图标语义和工作过程折叠状态的静态回归验证
 * [POS]: task-run-activity 整轮状态模式的单元测试
 * [DOC]: design.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TaskRunStatus, TaskWorkTrace } from "./task-run-activity"

describe("任务运行反馈", () => {
  it("运行期间在消息流末尾显示通用且持续的处理状态", () => {
    const markup = renderToStaticMarkup(<TaskRunStatus />)

    expect(markup).toContain('data-slot="task-run-status"')
    expect(markup).toContain('aria-label="任务仍在处理"')
    expect(markup).toContain("正在处理")
    expect(markup).toContain("animate-pulse")
    expect(markup).not.toContain("思考中")
  })

  it("已完成的工作过程默认折叠并显示整轮耗时", () => {
    const markup = renderToStaticMarkup(
      <TaskWorkTrace hasDetails running={false} timing={{ startedAt: 1_000, completedAt: 146_000 }}>
        <p>联网搜索详情</p>
      </TaskWorkTrace>,
    )

    expect(markup).toContain("已工作 2m 25s")
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain("联网搜索详情")
  })
})
