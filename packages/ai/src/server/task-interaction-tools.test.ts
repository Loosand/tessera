/**
 * [INPUT]: 客户端问答、研究计划的合法与非法结构，以及任务 Skill 选择
 * [OUTPUT]: 工具 Schema、无执行暂停语义和 Research Skill 工具暴露边界的回归验证
 * [POS]: task-interaction-tools 的协议单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  createTaskInteractionTools,
  requestUserInputTool,
  taskResearchPlanInputSchema,
  taskUserInputRequestSchema,
} from "./task-interaction-tools"

describe("任务交互工具", () => {
  it("用无 execute 的客户端工具暂停并等待类型化回答", () => {
    expect(requestUserInputTool.execute).toBeUndefined()
    expect(
      taskUserInputRequestSchema.safeParse({
        title: "确认研究方向",
        questions: [
          {
            id: "meaning",
            kind: "single",
            prompt: "你指的是哪一个？",
            options: [
              { id: "book", label: "原著" },
              { id: "movie", label: "电影" },
            ],
            allowCustom: true,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      taskUserInputRequestSchema.safeParse({
        questions: [{ id: "broken", kind: "single", prompt: "不完整", options: [] }],
      }).success,
    ).toBe(false)
  })

  it("只在 Research Skill 中暴露研究计划工具", () => {
    expect(Object.keys(createTaskInteractionTools(null))).toEqual(["request-user-input"])
    expect(Object.keys(createTaskInteractionTools("research"))).toEqual([
      "request-user-input",
      "publish-research-plan",
    ])
    expect(
      taskResearchPlanInputSchema.safeParse({
        objective: "核对作品和改编之间的关系",
        scope: "原著、音乐剧和电影",
        questions: [
          { id: "q1", title: "原著的核心主题是什么？" },
          { id: "q2", title: "现代改编改变了什么？" },
        ],
      }).success,
    ).toBe(true)
  })
})
