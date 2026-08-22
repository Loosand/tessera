/**
 * [INPUT]: 当前文档、当前任务与同工作区历史任务
 * [OUTPUT]: 文档 AI 侧栏保留任务身份、历史切换和新建入口的静态回归验证
 * [POS]: agent-sidebar 窄栏信息架构的单元测试
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
import { AgentSidebar } from "./agent-sidebar"

describe("文档 AI 侧栏任务导航", () => {
  it("显示当前任务、历史切换和新建入口", () => {
    const markup = renderToStaticMarkup(
      <AgentSidebar
        activeTask={{ id: "task-current", status: "running", title: "Madeline 自媒体稿" }}
        document={null}
        tasks={[
          { id: "task-current", status: "running", title: "Madeline 自媒体稿" },
          { id: "task-history", status: "completed", title: "角色资料研究" },
        ]}
        onClose={() => undefined}
        onNewTask={() => undefined}
        onOpenTask={() => undefined}
      >
        <div>统一任务内容</div>
      </AgentSidebar>,
    )

    expect(markup).toContain('aria-label="切换侧栏任务"')
    expect(markup).toContain("Madeline 自媒体稿")
    expect(markup).toContain('aria-label="新建侧栏任务"')
    expect(markup).toContain('aria-label="正在生成"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain("统一任务内容")
  })
})
