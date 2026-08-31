/**
 * [INPUT]: 同一助手消息中的创建文档、创建项目、移动文档与结构检查工具 Part
 * [OUTPUT]: 面向对象名称的聚合 Operation 活动、完成折叠与审批保留回归验证
 * [POS]: content-operation-part 的服务端渲染单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContentOperationPart } from "./content-operation-part"

type ToolMessagePart = Extract<UIMessage["parts"][number], { type: "dynamic-tool" | `tool-${string}` }>

describe("内容 Operation 活动", () => {
  it("把同一回复中的领域动作聚合为一条可恢复活动时间线", () => {
    const parts = [
      {
        type: "tool-create-document",
        toolCallId: "create-document-1",
        state: "output-available",
        input: { title: "玛德琳：与自己和解的攀登", projectId: "project-inbox" },
        output: { project: { id: "project-inbox", name: "未归档" } },
      },
      {
        type: "tool-create-project",
        toolCallId: "create-project-1",
        state: "output-available",
        input: { name: "Celeste 专题" },
        output: { id: "project-celeste", name: "Celeste 专题" },
      },
      {
        type: "tool-move-documents",
        toolCallId: "move-documents-1",
        state: "output-available",
        input: { documentIds: ["document-madeline"], targetProjectId: "project-celeste" },
        output: { project: { id: "project-celeste", name: "Celeste 专题" } },
      },
      {
        type: "tool-inspect-project",
        toolCallId: "inspect-project-1",
        state: "output-available",
        input: { projectId: "project-celeste" },
        output: {
          project: { id: "project-celeste", name: "Celeste 专题" },
          documents: [{ relativePath: "玛德琳：与自己和解的攀登.md" }],
        },
      },
    ] as ToolMessagePart[]

    const markup = renderToStaticMarkup(<ContentOperationPart parts={parts} />)

    expect(markup.match(/data-slot="tool-chips"/gu)).toHaveLength(1)
    expect(markup).toContain("已完成 4 项内容操作")
    expect(markup).toContain("创建文档「玛德琳：与自己和解的攀登」")
    expect(markup).toContain("创建项目「Celeste 专题」")
    expect(markup).toContain("移动 1 篇文档到「Celeste 专题」")
    expect(markup).toContain("检查项目「Celeste 专题」结构")
    expect(markup).not.toContain("project-celeste")
    expect(markup).not.toContain("document-madeline")
  })

  it("聚合活动仍保留 AI SDK 标准人工审批", () => {
    const part = {
      type: "tool-create-document",
      toolCallId: "create-document-approval",
      state: "approval-requested",
      input: { title: "待确认文档", content: "# 正文", reason: "用户要求保存" },
      approval: { id: "approval-document", isAutomatic: false },
    } as ToolMessagePart

    const markup = renderToStaticMarkup(
      <ContentOperationPart parts={[part]} onToolApproval={() => undefined} />,
    )

    expect(markup).toContain("内容操作等待确认")
    expect(markup).toContain("创建正式文档「待确认文档」")
    expect(markup).toContain("允许执行")
  })
})
