/**
 * [INPUT]: 文档条目与包含标题、代码围栏的 Markdown 示例
 * [OUTPUT]: 侧栏排序、树结构和大纲提取的回归验证
 * [POS]: 工作区侧栏派生模型的单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, test } from "vitest"
import { buildDocumentTree, extractDocumentOutline, sortDocuments } from "./workspace-sidebar-model"

const documents = [
  { name: "B.md", relativePath: "docs/B.md", modifiedAt: 30, size: 1 },
  { name: "A.md", relativePath: "A.md", modifiedAt: 20, size: 1 },
]

describe("工作区侧栏模型", () => {
  test("支持名称与修改时间排序", () => {
    expect(sortDocuments(documents, "name-asc").map((document) => document.name)).toEqual(["A.md", "B.md"])
    expect(sortDocuments(documents, "modified-desc").map((document) => document.name)).toEqual([
      "B.md",
      "A.md",
    ])
  })

  test("文件树优先显示文件夹", () => {
    expect(buildDocumentTree(documents, "name-asc").map((node) => node.name)).toEqual(["docs", "A.md"])
  })

  test("大纲忽略代码围栏内的伪标题", () => {
    expect(extractDocumentOutline("# 标题\n```md\n## 代码\n```\n### 小节")).toEqual([
      { depth: 1, line: 1, text: "标题" },
      { depth: 3, line: 5, text: "小节" },
    ])
  })
})
