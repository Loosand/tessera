/**
 * [INPUT]: 工作区文档/目录条目、Markdown 草稿与侧栏排序偏好
 * [OUTPUT]: 文件树、扁平列表顺序与文档大纲模型
 * [POS]: 工作区侧栏不依赖 React 的派生数据层
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceDirectoryEntry, WorkspaceDocumentEntry } from "@tessera/contracts"

export type SidebarSort = "name-asc" | "modified-desc"

export interface DocumentTreeNode {
  name: string
  path: string
  document?: WorkspaceDocumentEntry
  children: DocumentTreeNode[]
}

export interface DocumentOutlineEntry {
  depth: number
  line: number
  text: string
}

export function sortDocuments(documents: WorkspaceDocumentEntry[], sort: SidebarSort) {
  return [...documents].sort((left, right) => {
    if (sort === "modified-desc" && left.modifiedAt !== right.modifiedAt) {
      return right.modifiedAt - left.modifiedAt
    }
    return left.relativePath.localeCompare(right.relativePath, "zh-CN")
  })
}

export function buildDocumentTree(
  documents: WorkspaceDocumentEntry[],
  sort: SidebarSort,
  directories: WorkspaceDirectoryEntry[] = [],
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

  for (const document of sortDocuments(documents, sort)) {
    ensurePath(document.relativePath).document = document
  }

  const sortNodes = (nodes: DocumentTreeNode[]) => {
    nodes.sort((left, right) => {
      if (Boolean(left.document) !== Boolean(right.document)) return left.document ? 1 : -1
      if (
        sort === "modified-desc" &&
        left.document?.modifiedAt !== undefined &&
        right.document?.modifiedAt !== undefined &&
        left.document.modifiedAt !== right.document.modifiedAt
      ) {
        return right.document.modifiedAt - left.document.modifiedAt
      }
      return left.name.localeCompare(right.name, "zh-CN")
    })
    for (const node of nodes) sortNodes(node.children)
  }

  sortNodes(root.children)
  return root.children
}

export function collectFolderPaths(nodes: DocumentTreeNode[], paths = new Set<string>()) {
  for (const node of nodes) {
    if (node.document) continue
    paths.add(node.path)
    collectFolderPaths(node.children, paths)
  }
  return paths
}

export function extractDocumentOutline(content: string) {
  const entries: DocumentOutlineEntry[] = []
  let insideFence = false

  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence
      return
    }
    if (insideFence) return

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) return
    const [, marker = "", rawText = ""] = match
    const text = rawText
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim()
    if (text) entries.push({ depth: marker.length, line: index + 1, text })
  })

  return entries
}
