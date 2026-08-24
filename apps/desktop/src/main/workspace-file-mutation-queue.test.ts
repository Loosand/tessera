/**
 * [INPUT]: 可控异步变更任务与相同/不同的规范工作区文件路径
 * [OUTPUT]: 同文件严格串行、不同文件保持并行且队列正确释放的回归验证
 * [POS]: 工作区文件 mutation queue 的确定性并发单元测试
 * [DOC]: docs/architecture/agent-file-capabilities.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, test } from "vitest"
import { withWorkspaceFileMutation } from "./workspace-file-mutation-queue"

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("工作区文件变更队列", () => {
  test("同一目标在前一个变更释放后才开始后续变更", async () => {
    const firstGate = deferred()
    const firstStarted = deferred()
    const order: string[] = []
    const first = withWorkspaceFileMutation("/workspace/README.md", async () => {
      order.push("first:start")
      firstStarted.resolve()
      await firstGate.promise
      order.push("first:end")
      return "first"
    })
    await firstStarted.promise
    const second = withWorkspaceFileMutation("/workspace/README.md", async () => {
      order.push("second:start")
      return "second"
    })

    await Promise.resolve()
    expect(order).toEqual(["first:start"])
    firstGate.resolve()

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"])
    expect(order).toEqual(["first:start", "first:end", "second:start"])
  })

  test("不同目标不共享全局写锁", async () => {
    const firstGate = deferred()
    const firstStarted = deferred()
    const first = withWorkspaceFileMutation("/workspace/a.md", async () => {
      firstStarted.resolve()
      await firstGate.promise
      return "a"
    })
    await firstStarted.promise

    await expect(withWorkspaceFileMutation("/workspace/b.md", async () => "b")).resolves.toBe("b")
    firstGate.resolve()
    await expect(first).resolves.toBe("a")
  })
})
