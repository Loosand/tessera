/**
 * [INPUT]: 顶层视图、当前任务持久化状态与文档 AI 侧栏状态
 * [OUTPUT]: 新任务、全部任务页面和历史任务行保持互斥选中的回归验证
 * [POS]: app-shell 侧栏导航选中态的纯函数单元测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { resolveHomeSidebarSelection } from "./app-shell"

describe("主侧栏选中态", () => {
  it("仅在打开未持久化草稿时选中新任务", () => {
    expect(
      resolveHomeSidebarSelection({
        activeTaskId: "draft-task",
        activeTaskPersisted: false,
        agentOpen: false,
        view: "task",
      }),
    ).toEqual({ activeItem: "new-task", activeTaskId: undefined })
  })

  it("打开历史任务时只选中对应任务行", () => {
    expect(
      resolveHomeSidebarSelection({
        activeTaskId: "saved-task",
        activeTaskPersisted: true,
        agentOpen: false,
        view: "task",
      }),
    ).toEqual({ activeItem: null, activeTaskId: "saved-task" })
  })

  it("文档 AI 侧栏继续选中其已保存任务且不选中新任务", () => {
    expect(
      resolveHomeSidebarSelection({
        activeTaskId: "sidebar-task",
        activeTaskPersisted: true,
        agentOpen: true,
        view: "workspace",
      }),
    ).toEqual({ activeItem: null, activeTaskId: "sidebar-task" })
  })

  it("全部任务页不占用侧栏一级菜单选中态", () => {
    expect(
      resolveHomeSidebarSelection({
        activeTaskId: "saved-task",
        activeTaskPersisted: true,
        agentOpen: false,
        view: "tasks",
      }),
    ).toEqual({ activeItem: null, activeTaskId: undefined })
  })
})
