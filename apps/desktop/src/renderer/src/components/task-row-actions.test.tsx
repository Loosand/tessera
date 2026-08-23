/**
 * [INPUT]: 活动、置顶与归档任务的 TaskRowActions
 * [OUTPUT]: 行尾置顶/归档/恢复命令及其可访问名称的静态回归验证
 * [POS]: 任务导航行尾操作的组件测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSummary } from "@tessera/contracts"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { TaskRowActions } from "./task-row-actions"

const TASK = {
  archivedAt: null,
  createdAt: 1,
  id: "task-actions",
  mode: "chat",
  pinnedAt: null,
  skillId: null,
  status: "completed",
  title: "测试对话",
  updatedAt: 2,
  workspaceId: null,
  workspaceName: null,
} satisfies TaskSessionSummary

describe("TaskRowActions", () => {
  it("活动对话在行尾提供置顶与归档按钮", () => {
    const markup = renderToStaticMarkup(
      <TaskRowActions task={TASK} onSetArchived={vi.fn()} onSetPinned={vi.fn()} />,
    )

    expect(markup).toContain('aria-label="置顶“测试对话”"')
    expect(markup).toContain('aria-label="归档“测试对话”"')
  })

  it("归档对话只提供恢复按钮", () => {
    const markup = renderToStaticMarkup(
      <TaskRowActions task={{ ...TASK, archivedAt: 3 }} onSetArchived={vi.fn()} onSetPinned={vi.fn()} />,
    )

    expect(markup).toContain('aria-label="恢复“测试对话”"')
    expect(markup).not.toContain("置顶")
  })
})
