/**
 * [INPUT]: Electron IPC 调用失败原因
 * [OUTPUT]: 主进程版本错配与普通 Skill 错误的用户可读文案回归验证
 * [POS]: use-user-skills 错误边界的纯函数单元测试
 * [DOC]: docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { userSkillErrorMessage } from "./use-user-skills"

describe("用户 Skill 错误文案", () => {
  it("把新渲染层连接旧主进程改写为可执行提示", () => {
    expect(
      userSkillErrorMessage(
        new Error(
          "Error invoking remote method 'skill:user-install': Error: No handler registered for 'skill:user-install'",
        ),
      ),
    ).toBe("Tessera 主进程尚未加载最新技能功能，请重启应用后重试。")
  })

  it("保留领域服务返回的具体错误", () => {
    expect(userSkillErrorMessage(new Error("SKILL.md 缺少 YAML frontmatter。"))).toBe(
      "SKILL.md 缺少 YAML frontmatter。",
    )
  })
})
