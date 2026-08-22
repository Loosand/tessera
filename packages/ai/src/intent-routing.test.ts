/**
 * [INPUT]: 自动/显式创作方式与典型中文创作请求
 * [OUTPUT]: 显式选择优先、写作交付优先于研究过程、普通问答保持自动的意图回归验证
 * [POS]: 自动意图路由纯逻辑测试
 * [DOC]: docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { inferAutomaticTaskSkill } from "./intent-routing"

describe("自动创作意图", () => {
  it("保留用户显式选择", () => {
    expect(inferAutomaticTaskSkill("question-answering", "帮我写一篇文章")).toBe("question-answering")
  })

  it("同时出现研究过程和正式交付时优先采用写作 Skill", () => {
    expect(inferAutomaticTaskSkill(null, "我想深入了解一下，写个自媒体稿子")).toBe("writing")
  })

  it("识别边界明确的研究请求", () => {
    expect(inferAutomaticTaskSkill(null, "帮我系统调研 Celeste 主角的创作背景")).toBe("research")
  })

  it("普通问答和项目操作保持自动，不擅自切成离线问答", () => {
    expect(inferAutomaticTaskSkill(null, "Celeste 的主角是谁？")).toBeNull()
    expect(inferAutomaticTaskSkill(null, "给刚才的稿子建一个独立项目")).toBeNull()
  })
})
