/**
 * [INPUT]: 当前任务 Artifact 摘要与打开回调
 * [OUTPUT]: 标题、所属项目和可操作产物卡片的静态呈现回归验证
 * [POS]: TaskArtifactTray 的产品级组件测试
 * [DOC]: design.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { TaskArtifactTray } from "./task-artifact-tray"

describe("任务 Artifact 卡片", () => {
  it("显示正式文档标题、当前项目和打开入口", () => {
    const markup = renderToStaticMarkup(
      <TaskArtifactTray
        artifacts={[
          {
            id: "artifact-1",
            taskId: "task-1",
            runId: "run-1",
            documentId: "document-1",
            relation: "created",
            document: {
              id: "document-1",
              mediaType: "text/markdown",
              projectId: "project-1",
              title: "玛德琳：一座山，和她自己",
            },
            project: { id: "project-1", name: "《Celeste》玛德琳专题" },
            relativePath: "玛德琳：一座山，和她自己.md",
            updatedAt: 1,
          },
        ]}
        onOpen={vi.fn()}
      />,
    )

    expect(markup).toContain('aria-label="当前任务产物"')
    expect(markup).toContain("玛德琳：一座山，和她自己")
    expect(markup).toContain("《Celeste》玛德琳专题")
    expect(markup).toContain("打开")
  })
})
