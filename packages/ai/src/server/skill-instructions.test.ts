/**
 * [INPUT]: 问答空选择、研究/写作内置 Skill 与主进程复核后的用户 Skill
 * [OUTPUT]: AI SDK instructions 只加载当前 Skill、拒绝未复核用户正文且保留权限边界的回归测试
 * [POS]: Chat/Agent 共用 Skill 指令装配的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createUserSkillDescriptor } from "@tessera/skills"
import { describe, expect, it } from "vitest"
import { buildTaskSkillInstructions } from "./skill-instructions"

describe("buildTaskSkillInstructions", () => {
  it("自动与问答模式不向模型注入 Skill", async () => {
    await expect(buildTaskSkillInstructions(null)).resolves.toBeUndefined()
    await expect(buildTaskSkillInstructions("question-answering")).resolves.toBeUndefined()
  })

  it("只注入选中的标准 Skill 并保留权限边界", async () => {
    const instructions = await buildTaskSkillInstructions("research")

    expect(instructions).toContain("Skill「研究」（$research）")
    expect(instructions).toContain('<skill name="research">')
    expect(instructions).toContain("不授予新工具、文件、网络或写入权限")
    expect(instructions).not.toContain('<skill name="writing">')
  })

  it("只接受与用户 Skill ID 匹配的主进程复核正文", async () => {
    const descriptor = createUserSkillDescriptor({
      name: "meeting-notes",
      description: "整理会议记录",
    })
    const skill = { ...descriptor, instructions: "先提取决定，再列出行动项。" }

    await expect(buildTaskSkillInstructions("user:meeting-notes")).rejects.toThrow("主进程校验")
    await expect(buildTaskSkillInstructions("user:other-skill", skill)).rejects.toThrow("主进程校验")
    await expect(buildTaskSkillInstructions("user:meeting-notes", skill)).resolves.toContain(
      "用户 Skill「Meeting Notes」（$meeting-notes）",
    )
  })
})
