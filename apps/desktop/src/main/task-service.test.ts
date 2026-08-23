/**
 * [INPUT]: 内存 SQLite、通用任务会话输入与模拟工作区
 * [OUTPUT]: 默认空间活动/归档任务分页、置顶排序、相同快照不刷新活动时间、版本化引申问题/运行/工具失败/本地反馈、可选读取、内置/用户 Skill 标记、兼容工作区创建约束、动态逐轮资源、任务 mode 不可变、创作模式逐轮切换和重命名/删除的回归验证
 * [POS]: task-service 主进程权限边界的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSaveInput, WorkspaceInfo } from "@tessera/contracts"
import { openDatabase, saveTaskSession, saveWorkspace } from "@tessera/database"
import { describe, expect, test, vi } from "vitest"
import { createDesktopTaskService } from "./task-service"

const WORKSPACE = {
  id: "workspace-test",
  name: "测试工作区",
  rootPath: "/tmp/tessera-task-service",
} satisfies WorkspaceInfo

describe("DesktopTaskService", () => {
  test("当前 Space 任务分页返回总数并校验页码边界", () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createDesktopTaskService(client)
    for (let index = 0; index < 13; index += 1) {
      saveTaskSession(client, {
        id: `service-page-task-${String(index).padStart(2, "0")}`,
        mode: "chat",
        workspaceId: null,
        title: `任务 ${index}`,
        status: "completed",
        updatedAt: new Date(index + 1),
        messagePayloads: [],
      })
    }

    expect(service.listPage(null, { page: 2, pageSize: 5 })).toMatchObject({
      page: 2,
      pageSize: 5,
      total: 13,
      totalPages: 3,
      items: [
        { id: "service-page-task-07" },
        { id: "service-page-task-06" },
        { id: "service-page-task-05" },
        { id: "service-page-task-04" },
        { id: "service-page-task-03" },
      ],
    })
    expect(() => service.listPage(null, { page: 0, pageSize: 5 })).toThrow("任务页码无效")
    expect(() => service.listPage(null, { page: 1, pageSize: 51 })).toThrow("每页任务数")
    client.close()
  })

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
            metadata: {
              providerId: "openrouter",
              modelId: "example/model",
              feedback: { rating: "negative", updatedAt: 1_788_000_000_000 },
            },
            parts: [
              { type: "reasoning", text: "核对资料", state: "done" },
              { type: "text", text: "结论", state: "done" },
              {
                type: "data-follow-up-questions",
                id: "follow-up-request-1",
                data: {
                  version: 1,
                  questions: [
                    { id: "follow-up-1", prompt: "哪些证据最值得继续核实？" },
                    { id: "follow-up-2", prompt: "这个结论还有哪些争议？" },
                  ],
                },
              },
              {
                type: "data-task-error",
                id: "task-error-request-1",
                data: { message: "供应商连接中断。", retryable: true },
              },
              {
                type: "data-tool-error",
                id: "tool-error-call-1",
                data: {
                  code: "conflict",
                  message: "文档已被修改。",
                  retryable: false,
                  toolCallId: "call-1",
                  toolName: "write-workspace-document",
                  version: 1,
                },
              },
            ],
          },
        ],
      },
      null,
    )

    expect(snapshot).toMatchObject({ mode: "chat", skillId: "research", workspaceId: null })
    expect(service.listDefault()).toMatchObject([{ id: "chat-task", workspaceId: null }])
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
      metadata: {
        modelId: "example/model",
        feedback: { rating: "negative", updatedAt: 1_788_000_000_000 },
      },
      parts: [
        { type: "reasoning", text: "核对资料" },
        { type: "text", text: "结论" },
        {
          type: "data-follow-up-questions",
          data: {
            version: 1,
            questions: [{ prompt: "哪些证据最值得继续核实？" }, { prompt: "这个结论还有哪些争议？" }],
          },
        },
        {
          type: "data-task-error",
          data: { message: "供应商连接中断。", retryable: true },
        },
        {
          type: "data-tool-error",
          data: { code: "conflict", toolCallId: "call-1", version: 1 },
        },
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

  test("重复保存相同对话快照不会改变最近活动时间", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-08-23T01:00:00.000Z"))
      const client = openDatabase({ path: ":memory:" })
      const service = createDesktopTaskService(client)
      const input: TaskSessionSaveInput = {
        id: "idempotent-chat",
        mode: "chat",
        skillId: null,
        status: "completed",
        title: "不会因打开而置顶",
        workspaceId: null,
        messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "你好" }] }],
      }

      const created = service.save(input, null)
      vi.setSystemTime(new Date("2026-08-23T02:00:00.000Z"))
      const unchanged = service.save(input, null)
      const changed = service.save(
        {
          ...input,
          messages: [
            ...input.messages,
            { id: "message-2", role: "assistant", parts: [{ type: "text", text: "你好。" }] },
          ],
        },
        null,
      )

      expect(unchanged.updatedAt).toBe(created.updatedAt)
      expect(changed.updatedAt).toBeGreaterThan(unchanged.updatedAt)
      client.close()
    } finally {
      vi.useRealTimers()
    }
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

  test("可以置顶、归档、分页读取并恢复对话", () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createDesktopTaskService(client)
    for (const [id, title] of [
      ["placement-a", "对话 A"],
      ["placement-b", "对话 B"],
    ] as const) {
      service.save(
        {
          id,
          mode: "chat",
          skillId: null,
          status: "completed",
          title,
          workspaceId: null,
          messages: [{ id: `${id}-message`, role: "user", parts: [{ type: "text", text: title }] }],
        },
        null,
      )
    }

    expect(service.setPinned("placement-a", true).pinnedAt).not.toBeNull()
    expect(service.listDefault()[0]?.id).toBe("placement-a")
    expect(service.setArchived("placement-a", true)).toMatchObject({
      archivedAt: expect.any(Number),
      pinnedAt: null,
    })
    expect(service.listDefault().map((task) => task.id)).toEqual(["placement-b"])
    expect(service.listPage(null, { archived: true, page: 1, pageSize: 10 })).toMatchObject({
      archived: true,
      total: 1,
      items: [{ id: "placement-a" }],
    })
    const archived = service.read("placement-a")
    expect(
      service.save(
        {
          ...archived,
          messages: [
            ...archived.messages,
            { id: "placement-a-continued", role: "user", parts: [{ type: "text", text: "继续" }] },
          ],
        },
        null,
      ).archivedAt,
    ).toBeNull()
    service.setArchived("placement-a", true)
    expect(service.setArchived("placement-a", false).archivedAt).toBeNull()
    expect(service.listDefault().map((task) => task.id)).toContain("placement-a")
    client.close()
  })

  test("主进程运行生命周期会直接收口任务状态并保留等待输入语义", () => {
    const client = openDatabase({ path: ":memory:" })
    const service = createDesktopTaskService(client)
    service.save(
      {
        id: "runtime-status",
        mode: "chat",
        skillId: "research",
        status: "idle",
        title: "运行状态",
        workspaceId: null,
        messages: [],
      },
      null,
    )

    expect(service.setRunStatus("runtime-status", "running")?.status).toBe("running")
    expect(service.setRunStatus("runtime-status", "waiting-input")?.status).toBe("waiting-input")
    expect(service.setRunStatus("runtime-status", "completed")?.status).toBe("completed")
    expect(service.setRunStatus("missing-task", "failed")).toBeNull()
    client.close()
  })
})
