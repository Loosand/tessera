/**
 * [INPUT]: tessera_tauri_lib 的应用构造入口
 * [OUTPUT]: Tauri 原生桌面进程
 * [POS]: Tauri 对照壳的最小二进制入口
 * [DOC]: docs/architecture/tauri-parity.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

fn main() {
    tessera_tauri_lib::run()
}
