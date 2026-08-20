/**
 * [INPUT]: 共享 AppInfo 契约与当前产品区域定义
 * [OUTPUT]: 应用信息工厂和只读产品区域列表
 * [POS]: 与平台无关的 Tessera 核心包入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo } from "@tessera/contracts"

export interface ProductArea {
  id: "library" | "reader" | "inbox" | "skills"
  title: string
  description: string
  status: "foundation" | "planned"
}

export const PRODUCT_AREAS: readonly ProductArea[] = [
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
] as const

export function createAppInfo(info: AppInfo): AppInfo {
  return { ...info }
}
