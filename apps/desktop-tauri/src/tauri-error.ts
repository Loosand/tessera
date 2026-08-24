/**
 * [INPUT]: Tauri invoke 以任意 rejection 值返回的 Rust 命令错误
 * [OUTPUT]: 保留可读消息且符合 renderer 约定的标准 Error
 * [POS]: Tauri transport 与共享 renderer 之间的错误规范化边界
 * [DOC]: docs/architecture/tauri-parity.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

function objectMessage(value: unknown) {
  if (!value || typeof value !== "object" || !("message" in value)) return null
  return typeof value.message === "string" && value.message ? value.message : null
}

export function toTauriError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "string" && value) return new Error(value)

  const message = objectMessage(value)
  if (message) return new Error(message)

  try {
    const serialized = JSON.stringify(value)
    if (serialized && serialized !== "{}") return new Error(`Tauri 调用失败：${serialized}`)
  } catch {
    // 非序列化 rejection 仍要落到稳定的 Error，而不是让 renderer 丢失错误类型。
  }
  return new Error("Tauri 调用失败。")
}
