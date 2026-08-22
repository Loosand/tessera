/**
 * [INPUT]: 内存 SQLite、通用任务会话输入与模拟工作区
 * [OUTPUT]: 无工作区任务、可选读取、内置/用户 Skill 标记、兼容工作区创建约束、动态逐轮资源、任务 mode 不可变、创作模式逐轮切换和重命名/删除的回归验证
 * [POS]: task-service 主进程权限边界的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceInfo } from "@tessera/contracts"
import { openDatabase, saveWorkspace } from "@tessera/database"
import { describe, expect, test } from "vitest"
import { createDesktopTaskService } from "./task-service"

const WORKSPACE = {
  id: "workspace-test",
  name: "测试工作区",
  rootPath: "/tmp/tessera-task-service",
} satisfies WorkspaceInfo

describe("DesktopTaskService", () => {
  test("Chat 可以在没有工作区时保存和授权运行", () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createDesktopTaskService(client)
    const snapshot = service.save(
      {
        id: "chat-task",
        mode: "chat",
        skillId: "research",
        status: "completed",
        title: "普通对话",
        workspaceId: null,
        messages: [
          {
            id: "assistant-message",
            role: "assistant",
            metadata: { providerId: "openrouter", modelId: "example/model" },
            parts: [
              { type: "reasoning", text: "核对资料", state: "done" },
              { type: "text", text: "结论", state: "done" },
            ],
          },
        ],
      },
      null,
    )

    expect(snapshot).toMatchObject({ mode: "chat", skillId: "research", workspaceId: null })
    expect(() => service.authorizeTurn("chat-task", "chat", null, "research")).not.toThrow()
    expect(() => service.authorizeTurn("chat-task", "chat", null, "writing")).not.toThrow()
    expect(
      service.save(
        {
          id: "chat-task",
          mode: "chat",
          skillId: "writing",
          status: "completed",
          title: "普通对话",
          workspaceId: null,
          messages: snapshot.messages,
        },
        null,
      ),
    ).toMatchObject({ skillId: "writing" })
    expect(service.read("chat-task").messages[0]).toMatchObject({
      metadata: { modelId: "example/model" },
      parts: [
        { type: "reasoning", text: "核对资料" },
        { type: "text", text: "结论" },
      ],
    })
    expect(
      service.save(
        {
          id: "question-answering-task",
          mode: "chat",
          skillId: "question-answering",
          status: "idle",
          title: "问答",
          messages: [],
          workspaceId: null,
        },
        null,
      ),
    ).toMatchObject({ mode: "chat", skillId: "question-answering", workspaceId: null })
    expect(
      service.save(
        {
          id: "user-skill-task",
          mode: "chat",
          skillId: "user:meeting-notes",
          status: "idle",
          title: "用户 Skill",
          messages: [],
          workspaceId: null,
        },
        null,
      ),
    ).toMatchObject({ skillId: "user:meeting-notes" })
    expect(() => service.authorizeTurn("user-skill-task", "chat", null, "user:../escape" as never)).toThrow(
      "任务 Skill 无效",
    )
    client.close()
  })

  test("旧 Agent 创建时必须绑定工作区，但后续可离开工作区继续同一任务", () => {
    const client = openDatabase({ path: ":memory:" })
    saveWorkspace(client, {
      id: WORKSPACE.id,
      rootPath: WORKSPACE.rootPath,
      displayName: WORKSPACE.name,
      lastOpenedAt: new Date(),
    })
    const service = createDesktopTaskService(client)

    expect(() =>
      service.save(
        {
          id: "agent-task",
          mode: "agent",
          skillId: null,
          status: "idle",
          title: "Agent",
          messages: [],
          workspaceId: null,
        },
        null,
      ),
    ).toThrow("Agent 任务必须绑定工作区")

    service.save(
      {
        id: "agent-task",
        mode: "agent",
        skillId: "writing",
        status: "idle",
        title: "Agent",
        messages: [],
        workspaceId: WORKSPACE.id,
      },
      WORKSPACE,
    )
    expect(() => service.authorizeTurn("agent-task", "agent", null, "writing")).not.toThrow()
    expect(
      service.save(
        {
          id: "agent-task",
          mode: "agent",
          skillId: "writing",
          status: "completed",
          title: "Agent",
          messages: [],
          workspaceId: WORKSPACE.id,
        },
        null,
      ),
    ).toMatchObject({ mode: "agent", workspaceId: WORKSPACE.id })
    expect(() =>
      service.save(
        {
          id: "agent-task",
          mode: "chat",
          skillId: "writing",
          status: "idle",
          title: "Agent",
          messages: [],
          workspaceId: WORKSPACE.id,
        },
        WORKSPACE,
      ),
    ).toThrow("不能切换模式")
    client.close()
  })

  test("主页草稿在窗口已打开工作区时仍保持未绑定", () => {
    const client = openDatabase({ path: ":memory:" })
    saveWorkspace(client, {
      id: WORKSPACE.id,
      rootPath: WORKSPACE.rootPath,
      displayName: WORKSPACE.name,
      lastOpenedAt: new Date(),
    })
    const service = createDesktopTaskService(client)

    const snapshot = service.save(
      {
        id: "standalone-chat",
        mode: "chat",
        skillId: null,
        status: "idle",
        title: "独立对话",
        messages: [],
        workspaceId: null,
      },
      WORKSPACE,
    )

    expect(snapshot.workspaceId).toBeNull()
    expect(snapshot.workspaceName).toBeNull()
    client.close()
  })

  test("可以重命名和删除已保存的对话", () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createDesktopTaskService(client)
    service.save(
      {
        id: "managed-chat",
        mode: "chat",
        skillId: null,
        status: "completed",
        title: "旧标题",
        workspaceId: null,
        messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "你好" }] }],
      },
      null,
    )

    expect(service.rename("managed-chat", "新标题").title).toBe("新标题")
    expect(service.read("managed-chat").title).toBe("新标题")
    expect(service.delete("managed-chat")).toBe(true)
    expect(service.readIfExists("managed-chat")).toBeNull()
    expect(() => service.read("managed-chat")).toThrow("找不到这个任务")
    client.close()
  })
})
