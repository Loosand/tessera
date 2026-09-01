/**
 * [INPUT]: 带事实活动标签/动作数的运行中与已完成任务工作过程组件
 * [OUTPUT]: 当前活动、像素网格、文字 shimmer、无左侧竖线和完成折叠状态的静态回归验证
 * [POS]: task-run-activity 整轮状态模式的单元测试
 * [DOC]: design.md、docs/architecture/agent-product-feedback-layer.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TaskWorkTrace } from "./task-run-activity"

describe("任务运行反馈", () => {
  it("运行期间由事实 Progress 直接呈现当前活动、像素网格与跑马灯文案", () => {
    const markup = renderToStaticMarkup(
      <TaskWorkTrace
        activityLabel="正在联网搜索"
        hasDetails
        running
        timing={{ startedAt: 1_000, completedAt: null }}
      >
        <p>联网搜索详情</p>
      </TaskWorkTrace>,
    )

    expect(markup.match(/tessera-loading-pixel/g)).toHaveLength(9)
    expect(markup).toContain("tessera-loading-label")
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain("联网搜索详情")
    expect(markup).toContain("正在联网搜索")
    expect(markup).not.toContain("border-l")
    expect(markup).not.toContain("正在处理")
    expect(markup).not.toContain("task-run-status")
  })

  it("已完成的工作过程默认折叠并显示整轮耗时", () => {
    const markup = renderToStaticMarkup(
      <TaskWorkTrace
        actionCount={2}
        hasDetails
        running={false}
        timing={{ startedAt: 1_000, completedAt: 146_000 }}
      >
        <p>联网搜索详情</p>
      </TaskWorkTrace>,
    )

    expect(markup).toContain("已完成 2 个动作 · 2m 25s")
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('data-paused=""')
    expect(markup).not.toContain("tessera-loading-label")
    expect(markup).not.toContain("联网搜索详情")
  })
})
