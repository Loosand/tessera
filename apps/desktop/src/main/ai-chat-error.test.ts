/**
 * [INPUT]: 配置、上下文超预算、主进程领域错误、供应商状态、网络、恢复和未知运行异常样例
 * [OUTPUT]: 公开错误分类、脱敏回退、上下文恢复建议和重试语义的回归保障
 * [POS]: AI 运行错误协议分类器的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { classifyTaskRunError, classifyTaskToolError, taskRunError } from "./ai-chat-error"
import { ContentLibraryError } from "./content-library-service"
import { McpConfigError } from "./mcp-service"
import { UserSkillError } from "./user-skill-service"

describe("AI chat public error protocol", () => {
  it("把配置错误保留为不可重试的公开失败", () => {
    const error = new Error("请先配置模型。")
    error.name = "AiProviderConfigError"

    expect(classifyTaskRunError(error, "start")).toEqual({
      code: "provider-config",
      message: "请先配置模型。",
      phase: "start",
      retryable: false,
      version: 1,
    })
  })

  it("把本地上下文超预算作为可操作且不可重试的输入失败", () => {
    const error = new Error("本轮上下文预计超过安全输入预算，请缩小材料范围。")
    error.name = "ContextBudgetExceededError"

    expect(classifyTaskRunError(error, "stream")).toMatchObject({
      code: "invalid-request",
      message: error.message,
      retryable: false,
    })
  })

  it("保留主进程领域错误的安全公开文案", () => {
    expect(classifyTaskRunError(new UserSkillError("Skill 已停用。"), "start")).toMatchObject({
      code: "invalid-request",
      message: "Skill 已停用。",
    })
    expect(
      classifyTaskRunError(new ContentLibraryError("内容库不可用。", "library-unavailable"), "stream"),
    ).toMatchObject({ code: "invalid-request", message: "内容库不可用。" })
    expect(classifyTaskRunError(new McpConfigError("MCP 配置无效。"), "stream")).toMatchObject({
      code: "tool-failed",
      message: "MCP 配置无效。",
    })
  })

  it("按供应商状态区分认证与限流", () => {
    expect(classifyTaskRunError({ statusCode: 401 }, "stream")).toMatchObject({
      code: "provider-auth",
      retryable: false,
    })
    expect(classifyTaskRunError({ statusCode: 429 }, "stream")).toMatchObject({
      code: "provider-rate-limit",
      httpStatus: 429,
      retryable: true,
    })
  })

  it("未知原始异常只返回安全文案", () => {
    expect(classifyTaskRunError(new Error("secret provider payload"), "stream")).toMatchObject({
      code: "provider-unavailable",
      message: "模型请求失败，请检查供应商配置、模型状态与网络连接。",
      retryable: true,
    })
  })

  it("恢复失败和应用中断使用独立稳定错误码", () => {
    expect(classifyTaskRunError(new Error("bad checkpoint"), "resume")).toMatchObject({
      code: "resume-failed",
      phase: "resume",
      retryable: false,
    })
    expect(taskRunError("stream-interrupted", "stream", "应用意外中断。")).toMatchObject({
      retryable: true,
      version: 1,
    })
  })

  it("工具失败保留调用关联并区分可重试网络错误与输入冲突", () => {
    expect(
      classifyTaskToolError("fetch failed: connection reset", "call-network", "read-web-source"),
    ).toMatchObject({
      code: "network",
      retryable: true,
      toolCallId: "call-network",
      toolName: "read-web-source",
      version: 1,
    })
    expect(
      classifyTaskToolError("文件已被修改，存在冲突。", "call-write", "write-workspace-document"),
    ).toMatchObject({ code: "conflict", retryable: false })
  })
})
