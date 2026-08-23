/**
 * [INPUT]: 当前文件 Space 的文档与目录条目
 * [OUTPUT]: 一级侧栏文件树排序、自然层级缩进、空目录保留和目录路径收集的回归验证
 * [POS]: Space 文件区块派生模型的单元测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, test } from "vitest"
import { buildDocumentTree, collectFolderPaths, fileTreeNodeInset } from "./space-files-model"

const documents = [
  { name: "B.md", relativePath: "docs/B.md", modifiedAt: 30, size: 1 },
  { name: "A.md", relativePath: "A.md", modifiedAt: 20, size: 1 },
]

describe("Space 侧栏文件模型", () => {
  test("文件树优先显示文件夹并按名称排序", () => {
    expect(buildDocumentTree(documents).map((node) => node.name)).toEqual(["docs", "A.md"])
  })

  test("文件树保留空目录并收集可展开路径", () => {
    const tree = buildDocumentTree(documents, [
      { name: "empty", relativePath: "empty" },
      { name: "nested", relativePath: "empty/nested" },
    ])

    expect(tree.map((node) => node.name)).toEqual(["docs", "empty", "A.md"])
    expect(tree.find((node) => node.path === "empty")?.children[0]?.path).toBe("empty/nested")
    expect([...collectFolderPaths(tree)]).toEqual(["docs", "empty", "empty/nested"])
  })

  test("根文件从自然起点开始，子级只增加一层缩进", () => {
    expect(fileTreeNodeInset(0)).toBe(6)
    expect(fileTreeNodeInset(1)).toBe(20)
  })
})
