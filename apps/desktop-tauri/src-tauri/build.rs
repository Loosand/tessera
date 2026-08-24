/**
 * [INPUT]: tauri.conf.json、capabilities、两个应用命令名与 Cargo 构建上下文
 * [OUTPUT]: Tauri v2 资源、细粒度应用命令权限和平台元数据生成步骤
 * [POS]: Tauri 原生包的构建脚本入口
 * [DOC]: docs/architecture/tauri-parity.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

const APP_COMMANDS: &[&str] = &["desktop_invoke", "desktop_send"];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("生成 Tauri 应用清单与权限失败");
}
