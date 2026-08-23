/**
 * [INPUT]: 运行状态、Skill 与工具摘要
 * [OUTPUT]: 对话内运行解释的稳定中文标签与紧凑工具归因测试
 * [POS]: run-inspection-popover 的纯展示回归测试
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { taskRunSkillLabel, taskRunStatusLabel, taskRunToolsLabel } from "./run-inspection-popover"

describe("运行解释标签", () => {
  it("区分自动、内置与用户 Skill", () => {
    expect(taskRunSkillLabel(null)).toBe("自动编排")
    expect(taskRunSkillLabel("research")).toBe("研究")
    expect(taskRunSkillLabel("writing")).toBe("写作")
    expect(taskRunSkillLabel("question-answering")).toBe("问答")
    expect(taskRunSkillLabel("user:screenwriter")).toBe("用户 Skill · screenwriter")
  })

  it("把结束状态和工具异常压缩为适合 popover 的摘要", () => {
    expect(taskRunStatusLabel("interrupted")).toBe("意外中断")
    expect(
      taskRunToolsLabel([
        { name: "web_search", callCount: 3, failureCount: 1, denialCount: 0 },
        { name: "create-document", callCount: 1, failureCount: 0, denialCount: 1 },
      ]),
    ).toBe("web_search（3 次 · 1 次失败）、create-document（1 次拒绝）")
    expect(taskRunToolsLabel([])).toBe("未调用工具")
  })
})
