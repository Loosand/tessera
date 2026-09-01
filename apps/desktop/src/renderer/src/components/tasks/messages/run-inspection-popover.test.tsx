/**
 * [INPUT]: 运行 Progress、Skill、Token/耗时数值、上下文预算与工具摘要
 * [OUTPUT]: 对话内进度/执行上下文/诊断的稳定中文标签、精确数值格式、预算状态与紧凑工具归因测试
 * [POS]: run-inspection-popover 的纯展示回归测试
 * [DOC]: docs/architecture/agent-product-feedback-layer.md、docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  taskRunContextStatusLabel,
  taskRunMetricLabel,
  taskRunProgressLabel,
  taskRunProgressPhaseLabel,
  taskRunSkillLabel,
  taskRunStatusLabel,
  taskRunToolsLabel,
} from "./run-inspection-popover"

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
    ).toBe("联网搜索（3 次 · 1 次失败）、创建正式文档（1 次拒绝）")
    expect(taskRunToolsLabel([])).toBe("未调用工具")
  })

  it("精确呈现 Token/耗时并不把未上报伪造为零", () => {
    expect(taskRunMetricLabel(958_948, "tokens")).toBe("958,948 Token")
    expect(taskRunMetricLabel(842, "milliseconds")).toBe("842 毫秒")
    expect(taskRunMetricLabel(12_345, "milliseconds")).toBe("12.35 秒")
    expect(taskRunMetricLabel(7, "value")).toBe("7")
    expect(taskRunMetricLabel(null, "tokens")).toBe("未返回")
  })

  it("区分上下文预算状态", () => {
    expect(taskRunContextStatusLabel("within-budget")).toBe("预算内")
    expect(taskRunContextStatusLabel("over-budget")).toBe("已超预算")
    expect(taskRunContextStatusLabel("unknown")).toBe("模型未声明上限")
  })

  it("用事件投影呈现当前或最终进度，不需要 reasoning 正文", () => {
    const inspection = {
      progress: {
        completedActionCount: 1,
        currentToolName: "bash",
        phase: "working",
        totalActionCount: 2,
      },
    } as Parameters<typeof taskRunProgressLabel>[0]
    expect(taskRunProgressLabel(inspection)).toBe("正在运行工作区命令")
    expect(
      taskRunProgressLabel({
        ...inspection,
        progress: { ...inspection.progress, currentToolName: null, phase: "completed" },
      }),
    ).toBe("已完成")
    expect(
      taskRunProgressLabel({
        ...inspection,
        progress: {
          ...inspection.progress,
          currentToolName: "request-user-input",
          phase: "waiting",
        },
      }),
    ).toBe("等待用户回答")
    expect(taskRunProgressPhaseLabel("waiting")).toBe("等待用户")
  })
})
