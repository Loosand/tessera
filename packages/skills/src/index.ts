/**
 * [INPUT]: Agent 权限效果类型与 SKILL.md 文件约定
 * [OUTPUT]: Skill 描述、作用域和权限契约
 * [POS]: Skill 发现与加载能力的领域入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { PermissionEffect } from "@tessera/agent-runtime"

export const SKILL_FILENAME = "SKILL.md"

export interface SkillPermission {
  action: string
  resource: string
  effect: PermissionEffect
}

export interface SkillDescriptor {
  name: string
  description: string
  root: string
  scope: "user" | "workspace"
  permissions: readonly SkillPermission[]
}
