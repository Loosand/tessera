/**
 * [INPUT]: 共享 AppInfo 契约与当前产品区域定义
 * [OUTPUT]: 保留字面量类型的应用信息工厂、产品区域目录及其派生联合类型
 * [POS]: 与平台无关的 Tessera 核心包入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo } from "@tessera/contracts"

type ProductAreaDefinition = {
  id: "library" | "reader" | "inbox" | "skills"
  title: string
  description: string
  status: "foundation" | "planned"
}

export const PRODUCT_AREAS = [
  {
    id: "library",
    title: "Library",
    description: "Open local Markdown workspaces without importing or migrating them.",
    status: "foundation",
  },
  {
    id: "reader",
    title: "Reader",
    description: "Read, annotate, edit, and review AI-proposed changes in one place.",
    status: "planned",
  },
  {
    id: "inbox",
    title: "Inbox",
    description: "Bring RSS, Atom, and web sources into a focused reading queue.",
    status: "planned",
  },
  {
    id: "skills",
    title: "Skills",
    description: "Run portable SKILL.md workflows with visible permissions and history.",
    status: "foundation",
  },
] as const satisfies readonly ProductAreaDefinition[]

export type ProductArea = (typeof PRODUCT_AREAS)[number]
export type ProductAreaId = ProductArea["id"]
export type ProductAreaStatus = ProductArea["status"]

export function createAppInfo<const Info extends AppInfo>(info: Info): Info {
  return { ...info }
}
