/**
 * [INPUT]: 跨进程运行时守卫与合法、畸形 RunPolicy 样例
 * [OUTPUT]: 共享契约在运行时拒绝非正安全整数资源限制的回归验证
 * [POS]: contracts 包的运行时数据边界单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { isTaskRunPolicy, type TaskRunPolicy } from "./index"

const POLICY = {
  limits: { maxOutputTokens: null, maxSteps: 8, timeoutMs: 120_000 },
  mode: "agent",
  reasoning: "auto",
  skillId: "research",
  toolScope: "workspace-read",
  webSearch: true,
} as const satisfies TaskRunPolicy

describe("共享运行策略契约", () => {
  it("接受合法策略及不覆盖输出上限的 null", () => {
    expect(isTaskRunPolicy(POLICY)).toBe(true)
    expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, maxOutputTokens: 4_096 } })).toBe(true)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "拒绝无效 maxSteps：%s",
    (maxSteps) => {
      expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, maxSteps } })).toBe(false)
    },
  )

  it("对所有资源限制使用同一正安全整数边界", () => {
    expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, maxOutputTokens: Number.NaN } })).toBe(
      false,
    )
    expect(isTaskRunPolicy({ ...POLICY, limits: { ...POLICY.limits, timeoutMs: -1 } })).toBe(false)
  })
})
