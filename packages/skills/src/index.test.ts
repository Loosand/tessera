/**
 * [INPUT]: 标准 SKILL.md 文本与内置 Skill 注册表
 * [OUTPUT]: frontmatter 校验、元数据常驻和正文按需加载的回归测试
 * [POS]: Skill 渐进式加载协议的单元测试
 * [DOC]: docs/architecture.md、docs/architecture/plugin-system.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { listBuiltInSkills, loadBuiltInSkill, parseSkillDocument } from "./index"

describe("Skill 注册表", () => {
  it("常驻目录只公开元数据与权限声明", () => {
    const skills = listBuiltInSkills()

    expect(skills.map((skill) => skill.name)).toEqual(["research", "writing"])
    expect(skills.every((skill) => !("instructions" in skill))).toBe(true)
    expect(skills[0]?.permissions).toContainEqual({
      action: "network.search",
      effect: "ask",
      resource: "internet",
    })
  })

  it("只在选中后加载并校验 SKILL.md 正文", async () => {
    await expect(loadBuiltInSkill(null)).resolves.toBeNull()
    await expect(loadBuiltInSkill("research")).resolves.toMatchObject({
      displayName: "研究",
      instructions: expect.stringContaining("# 研究"),
    })
    await expect(loadBuiltInSkill("writing")).resolves.toMatchObject({
      displayName: "写作",
      instructions: expect.stringContaining("# 写作"),
    })
  })
})

describe("SKILL.md 校验", () => {
  it("仅接受 name、description 和非空正文", () => {
    expect(parseSkillDocument(`---\nname: sample-skill\ndescription: "示例 Skill"\n---\n\n# 指令\n`)).toEqual(
      { name: "sample-skill", description: "示例 Skill", instructions: "# 指令" },
    )

    expect(() => parseSkillDocument("---\nname: sample\ndescription: 示例\nversion: 1\n---\n\n正文")).toThrow(
      "未知字段",
    )
    expect(() => parseSkillDocument("---\nname: Sample\ndescription: 示例\n---\n\n正文")).toThrow(
      "kebab-case",
    )
  })
})
