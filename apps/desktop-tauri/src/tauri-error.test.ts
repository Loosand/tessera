/**
 * [INPUT]: 字符串、结构化对象、既有 Error 与不可序列化的 Tauri rejection
 * [OUTPUT]: transport 错误消息和 Error 类型的回归验证
 * [POS]: Tauri Rust 错误跨 WebView 边界后的保真守卫
 * [DOC]: docs/architecture/tauri-parity.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, test } from "vitest"
import { toTauriError } from "./tauri-error"

describe("toTauriError", () => {
  test("保留 Rust 字符串错误并转换为 Error", () => {
    const error = toTauriError("Tauri 对照壳尚未实现桌面频道 workspace:select。")

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("尚未实现")
  })

  test("保留既有 Error 和结构化 message", () => {
    const existing = new Error("existing")

    expect(toTauriError(existing)).toBe(existing)
    expect(toTauriError({ message: "structured" }).message).toBe("structured")
  })

  test("为未知 rejection 提供稳定兜底", () => {
    expect(toTauriError(undefined).message).toBe("Tauri 调用失败。")
    expect(toTauriError({ code: 7 }).message).toContain('"code":7')
  })
})
