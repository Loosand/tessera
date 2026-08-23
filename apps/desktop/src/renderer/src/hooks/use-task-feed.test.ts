/**
 * [INPUT]: 最近任务页合并器与分页任务摘要
 * [OUTPUT]: 加载更多按顺序去重追加、第一页刷新重置旧结果的回归验证
 * [POS]: 侧栏最近任务渐进加载的纯状态单元测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionPage, TaskSessionSummary } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { mergeTaskFeedPage } from "./use-task-feed"

function task(id: string): TaskSessionSummary {
  return {
    createdAt: 1,
    id,
    mode: "chat",
    skillId: null,
    status: "completed",
    title: id,
    updatedAt: 1,
    workspaceId: null,
    workspaceName: null,
  }
}

function page(pageNumber: number, ids: string[]): TaskSessionPage {
  return {
    items: ids.map(task),
    page: pageNumber,
    pageSize: 2,
    total: 4,
    totalPages: 2,
  }
}

describe("最近任务渐进加载", () => {
  it("追加后续页并按任务 ID 去重", () => {
    const result = mergeTaskFeedPage(page(1, ["a", "b"]), page(2, ["b", "c"]))
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c"])
    expect(result.page).toBe(2)
  })

  it("重新读取第一页时丢弃旧的累计结果", () => {
    const result = mergeTaskFeedPage(page(2, ["a", "b", "c"]), page(1, ["new", "a"]))
    expect(result.items.map((item) => item.id)).toEqual(["new", "a"])
    expect(result.page).toBe(1)
  })
})
