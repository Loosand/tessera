/**
 * [INPUT]: 内置 Skill 注册表与用户 Skill 管理页服务端渲染结果
 * [OUTPUT]: 管理页展示注册表、单目录导入/扫描入口、权限边界和真实能力状态的回归验证
 * [POS]: skill-management-page 的静态内容单元测试
 * [DOC]: docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SkillManagementPage } from "./skill-management-page"

describe("Skill 管理页", () => {
  it("从内置注册表展示 Skill、导入入口与不提权边界", () => {
    const markup = renderToStaticMarkup(
      <SkillManagementPage sidebarOpen onToggleSidebar={() => undefined} onUseSkill={() => undefined} />,
    )

    expect(markup).toContain("已安装 2 个 Skill")
    expect(markup).toContain("研究")
    expect(markup).toContain("写作")
    expect(markup).toContain("声明只描述所需能力，不会自动授予联网或文件权限")
    expect(markup).toContain("添加 Skill")
    expect(markup).toContain("扫描 Skill")
    expect(markup).toContain("附带脚本不会自动执行")
  })
})
