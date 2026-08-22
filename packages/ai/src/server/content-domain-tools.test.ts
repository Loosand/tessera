/**
 * [INPUT]: 注入的内容领域能力与 AI SDK 工具定义
 * [OUTPUT]: 查询工具可直接执行、创建和移动工具强制标准审批及输入 Schema 的回归验证
 * [POS]: 统一创作 Agent 内容领域工具适配层测试
 * [DOC]: docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it, vi } from "vitest"
import { createContentDomainToolSet, createManagedDocumentInputSchema } from "./content-domain-tools"

describe("内容领域 AI SDK 工具", () => {
  it("正式文档输入只接收标题、正文、理由和可选项目 ID", () => {
    expect(
      createManagedDocumentInputSchema.parse({
        title: "玛德琳",
        content: "# 玛德琳",
        reason: "用户要求正式成稿",
      }),
    ).toEqual({ title: "玛德琳", content: "# 玛德琳", reason: "用户要求正式成稿" })
    expect(() =>
      createManagedDocumentInputSchema.parse({
        title: "玛德琳",
        content: "# 玛德琳",
        reason: "用户要求正式成稿",
        rootPath: "/tmp/escape",
      }),
    ).toThrow()
  })

  it("查询不审批，创建项目/文档和移动全部使用 AI SDK needsApproval", async () => {
    const listProjects = vi.fn(async () => [{ id: "inbox", name: "未归档" }])
    const tools = createContentDomainToolSet(
      {
        listProjects,
        listArtifacts: vi.fn(async () => []),
        inspectProject: vi.fn(async () => ({})),
        createDocument: vi.fn(async () => ({})),
        createProject: vi.fn(async () => ({})),
        moveDocuments: vi.fn(async () => ({})),
      },
      new AbortController().signal,
    )

    expect(tools["list-projects"].needsApproval).toBeUndefined()
    expect(tools["create-document"].needsApproval).toBe(true)
    expect(tools["create-project"].needsApproval).toBe(true)
    expect(tools["move-documents"].needsApproval).toBe(true)
    await tools["list-projects"].execute?.(
      {},
      {
        toolCallId: "tool-list",
        messages: [],
        abortSignal: new AbortController().signal,
        context: undefined,
      },
    )
    expect(listProjects).toHaveBeenCalledOnce()
  })
})
