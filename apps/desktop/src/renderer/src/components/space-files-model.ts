/**
 * [INPUT]: 当前文件 Space 的 Markdown 文档与真实目录条目
 * [OUTPUT]: 文件夹优先、按名称稳定排序的侧栏文件树、自然层级缩进及可用目录路径集合
 * [POS]: 一级 Space 侧栏文件区块的不依赖 React 派生层
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceDirectoryEntry, WorkspaceDocumentEntry } from "@tessera/contracts"

export type DocumentTreeNode = {
  name: string
  path: string
  document?: WorkspaceDocumentEntry
  children: DocumentTreeNode[]
}

export function fileTreeNodeInset(depth: number) {
  return 6 + Math.max(0, depth) * 14
}

export function buildDocumentTree(
  documents: readonly WorkspaceDocumentEntry[],
  directories: readonly WorkspaceDirectoryEntry[] = [],
) {
  const root: DocumentTreeNode = { name: "", path: "", children: [] }

  const ensurePath = (relativePath: string) => {
    const segments = relativePath.split("/").filter(Boolean)
    let parent = root

    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/")
      let node = parent.children.find((child) => child.name === segment)
      if (!node) {
        node = { name: segment, path, children: [] }
        parent.children.push(node)
      }
      parent = node
    })

    return parent
  }

  for (const directory of directories) ensurePath(directory.relativePath)
  for (const document of documents) ensurePath(document.relativePath).document = document

  const sortNodes = (nodes: DocumentTreeNode[]) => {
    nodes.sort((left, right) => {
      if (Boolean(left.document) !== Boolean(right.document)) return left.document ? 1 : -1
      return left.name.localeCompare(right.name, "zh-CN")
    })
    for (const node of nodes) sortNodes(node.children)
  }

  sortNodes(root.children)
  return root.children
}

export function collectFolderPaths(nodes: readonly DocumentTreeNode[], paths = new Set<string>()) {
  for (const node of nodes) {
    if (node.document) continue
    paths.add(node.path)
    collectFolderPaths(node.children, paths)
  }
  return paths
}
