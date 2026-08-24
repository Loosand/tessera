/**
 * [INPUT]: Tauri v2 应用/窗口生命周期、共享 DesktopApi 频道字符串与 JSON 参数
 * [OUTPUT]: 严格 allowlist 的 desktop_invoke/desktop_send、首屏无副作用空态、三态关闭保存握手与单一事件 envelope
 * [POS]: Tauri WebView 与未来桌面运行时之间的原生安全边界
 * [DOC]: docs/architecture/tauri-parity.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

const DESKTOP_EVENT_NAME: &str = "tessera-desktop-event";

const INVOKE_CHANNELS: [&str; 58] = [
    "app:info",
    "ai-devtools:open",
    "content-library:current",
    "content-library:select",
    "content-library:revoke",
    "workspace:current",
    "workspace:open-default",
    "workspace:select",
    "workspace:recent",
    "workspace:open-recent",
    "workspace:reveal",
    "workspace:reveal-recent",
    "workspace:copy-path",
    "workspace:remove-recent",
    "workspace:list-documents",
    "workspace:list-directories",
    "document:read",
    "document:create",
    "document:rename",
    "document:write",
    "workspace-entry:copy-path",
    "workspace-entry:create-directory",
    "workspace-entry:delete",
    "workspace-entry:rename-directory",
    "workspace-entry:reveal",
    "ai-provider:delete-config",
    "ai-provider:list-configs",
    "ai-provider:list-models",
    "ai-provider:save-config",
    "research-network:get",
    "research-network:set",
    "research:notebook-read",
    "research:sources-save",
    "mcp:server-delete",
    "mcp:server-list",
    "mcp:server-save",
    "mcp:server-test",
    "skill:user-delete",
    "skill:user-install",
    "skill:user-install-scanned",
    "skill:user-list",
    "skill:user-scan",
    "skill:user-set-enabled",
    "ai-chat:resume",
    "ai-chat:start",
    "task-run:read",
    "agent-change:preview",
    "task:list-recent",
    "task:list-default",
    "task:list-workspace",
    "task:list-page",
    "task:read",
    "task:save",
    "task:rename",
    "task:set-pinned",
    "task:set-archived",
    "task:delete",
    "task:list-artifacts",
];

const SEND_CHANNELS: [&str; 3] = ["app:cancel-close", "app:confirm-close", "ai-chat:cancel"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum CloseState {
    Idle = 0,
    Pending = 1,
    Approved = 2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CloseRequestAction {
    Allow,
    Emit,
    Prevent,
}

#[derive(Default)]
struct DesktopState {
    close_state: AtomicU8,
}

impl DesktopState {
    fn close_state(&self) -> CloseState {
        match self.close_state.load(Ordering::SeqCst) {
            value if value == CloseState::Idle as u8 => CloseState::Idle,
            value if value == CloseState::Pending as u8 => CloseState::Pending,
            value if value == CloseState::Approved as u8 => CloseState::Approved,
            value => panic!("检测到无效关闭状态 {value}"),
        }
    }

    fn on_close_requested(&self) -> CloseRequestAction {
        loop {
            match self.close_state() {
                CloseState::Idle => {
                    if self
                        .close_state
                        .compare_exchange(
                            CloseState::Idle as u8,
                            CloseState::Pending as u8,
                            Ordering::SeqCst,
                            Ordering::SeqCst,
                        )
                        .is_ok()
                    {
                        return CloseRequestAction::Emit;
                    }
                }
                CloseState::Pending => return CloseRequestAction::Prevent,
                CloseState::Approved => {
                    if self
                        .close_state
                        .compare_exchange(
                            CloseState::Approved as u8,
                            CloseState::Idle as u8,
                            Ordering::SeqCst,
                            Ordering::SeqCst,
                        )
                        .is_ok()
                    {
                        return CloseRequestAction::Allow;
                    }
                }
            }
        }
    }

    fn cancel_close(&self) {
        let _ = self.close_state.compare_exchange(
            CloseState::Pending as u8,
            CloseState::Idle as u8,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    fn restore_pending_after_emit_failure(&self) {
        let _ = self.close_state.compare_exchange(
            CloseState::Pending as u8,
            CloseState::Idle as u8,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    fn confirm_close_with(
        &self,
        close_window: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        self.close_state
            .compare_exchange(
                CloseState::Pending as u8,
                CloseState::Approved as u8,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .map_err(|_| "没有待确认的窗口关闭请求。".to_owned())?;

        if let Err(error) = close_window() {
            let _ = self.close_state.compare_exchange(
                CloseState::Approved as u8,
                CloseState::Idle as u8,
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
            return Err(error);
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
struct DesktopEventEnvelope<'a> {
    arguments: Vec<Value>,
    channel: &'a str,
}

fn require_argument_count(
    channel: &str,
    arguments: &[Value],
    expected: usize,
) -> Result<(), String> {
    if arguments.len() == expected {
        return Ok(());
    }
    Err(format!(
        "桌面频道 {channel} 参数数量无效：预期 {expected}，收到 {}。",
        arguments.len()
    ))
}

fn unsupported(channel: &str) -> Result<Value, String> {
    Err(format!("Tauri 对照壳尚未实现桌面频道 {channel}。"))
}

fn empty_task_page(arguments: &[Value]) -> Result<Value, String> {
    require_argument_count("task:list-page", arguments, 1)?;
    let request = arguments[0]
        .as_object()
        .ok_or_else(|| "桌面频道 task:list-page 需要分页对象。".to_owned())?;
    let archived = match request.get("archived") {
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err("任务归档筛选无效。".to_owned()),
        None => false,
    };
    let page = request
        .get("page")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| "任务页码无效。".to_owned())?;
    let page_size = request
        .get("pageSize")
        .and_then(Value::as_u64)
        .filter(|value| (1..=50).contains(value))
        .ok_or_else(|| "每页任务数必须在 1–50 之间。".to_owned())?;
    let mut response = Map::new();
    response.insert("archived".to_owned(), json!(archived));
    response.insert("page".to_owned(), json!(page));
    response.insert("pageSize".to_owned(), json!(page_size));
    response.insert("items".to_owned(), json!([]));
    response.insert("total".to_owned(), json!(0));
    response.insert("totalPages".to_owned(), json!(1));
    Ok(Value::Object(response))
}

fn dispatch_invoke(channel: &str, arguments: &[Value]) -> Result<Value, String> {
    if !INVOKE_CHANNELS.contains(&channel) {
        return Err(format!("拒绝未列入 allowlist 的桌面调用频道 {channel}。"));
    }

    match channel {
        "app:info" => {
            require_argument_count(channel, arguments, 0)?;
            Ok(json!({
                "name": "Tessera Tauri",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": platform_name(),
                "runtime": "tauri"
            }))
        }
        "content-library:current" => {
            require_argument_count(channel, arguments, 0)?;
            Ok(json!({ "ok": true, "library": null }))
        }
        "workspace:current" | "workspace:open-default" => {
            require_argument_count(channel, arguments, 0)?;
            Ok(Value::Null)
        }
        "workspace:recent"
        | "workspace:list-documents"
        | "workspace:list-directories"
        | "ai-provider:list-configs"
        | "mcp:server-list"
        | "skill:user-list"
        | "task:list-recent"
        | "task:list-default"
        | "task:list-workspace" => {
            require_argument_count(channel, arguments, 0)?;
            Ok(json!([]))
        }
        "research-network:get" => {
            require_argument_count(channel, arguments, 0)?;
            Ok(json!("system"))
        }
        "research:notebook-read" | "task-run:read" => {
            require_argument_count(channel, arguments, 2)?;
            Ok(Value::Null)
        }
        "ai-chat:resume" => {
            require_argument_count(channel, arguments, 1)?;
            Ok(json!({ "ok": true, "run": null }))
        }
        "task:list-page" => empty_task_page(arguments),
        "task:list-artifacts" => {
            require_argument_count(channel, arguments, 1)?;
            Ok(json!([]))
        }
        _ => unsupported(channel),
    }
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "macos")]
    return "darwin";
    #[cfg(target_os = "windows")]
    return "win32";
    #[cfg(target_os = "linux")]
    return "linux";
    #[allow(unreachable_code)]
    "unknown"
}

#[tauri::command]
fn desktop_invoke(channel: String, arguments: Vec<Value>) -> Result<Value, String> {
    dispatch_invoke(&channel, &arguments)
}

#[tauri::command]
fn desktop_send(
    app: AppHandle,
    state: State<'_, DesktopState>,
    channel: String,
    arguments: Vec<Value>,
) -> Result<(), String> {
    if !SEND_CHANNELS.contains(&channel.as_str()) {
        return Err(format!("拒绝未列入 allowlist 的桌面单向频道 {channel}。"));
    }
    require_argument_count(
        &channel,
        &arguments,
        if channel == "ai-chat:cancel" { 1 } else { 0 },
    )?;

    match channel.as_str() {
        "app:cancel-close" => state.cancel_close(),
        "app:confirm-close" => state.confirm_close_with(|| {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Tauri 主窗口不存在。".to_owned())?;
            window.close().map_err(|error| error.to_string())
        })?,
        _ => {}
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![desktop_invoke, desktop_send])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<DesktopState>();
                match state.on_close_requested() {
                    CloseRequestAction::Allow => {}
                    CloseRequestAction::Prevent => api.prevent_close(),
                    CloseRequestAction::Emit => {
                        api.prevent_close();
                        if let Err(error) = window.emit(
                            DESKTOP_EVENT_NAME,
                            DesktopEventEnvelope {
                                arguments: Vec::new(),
                                channel: "app:close-requested",
                            },
                        ) {
                            state.restore_pending_after_emit_failure();
                            eprintln!("发送关闭保存握手失败：{error}");
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri 对照壳运行失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn invoke_allowlist_has_expected_unique_channels() {
        assert_eq!(INVOKE_CHANNELS.len(), 58);
        assert_eq!(
            INVOKE_CHANNELS
                .iter()
                .copied()
                .collect::<HashSet<_>>()
                .len(),
            58
        );
    }

    #[test]
    fn rejects_unknown_channels() {
        let error = dispatch_invoke("shell:execute", &[]).expect_err("unknown channel must fail");
        assert!(error.contains("allowlist"));
    }

    #[test]
    fn app_info_identifies_tauri_runtime() {
        let value = dispatch_invoke("app:info", &[]).expect("app info should exist");
        assert_eq!(value["runtime"], "tauri");
        assert_eq!(value["platform"], platform_name());
    }

    #[test]
    fn initial_collections_are_empty_without_errors() {
        for channel in [
            "workspace:recent",
            "ai-provider:list-configs",
            "mcp:server-list",
            "skill:user-list",
            "task:list-recent",
            "task:list-default",
        ] {
            assert_eq!(dispatch_invoke(channel, &[]).expect(channel), json!([]));
        }
    }

    #[test]
    fn empty_task_page_preserves_request_shape() {
        let value = dispatch_invoke(
            "task:list-page",
            &[json!({ "archived": true, "page": 2, "pageSize": 20 })],
        )
        .expect("page should be valid");
        assert_eq!(value["archived"], true);
        assert_eq!(value["page"], 2);
        assert_eq!(value["pageSize"], 20);
        assert_eq!(value["items"], json!([]));
        assert_eq!(value["total"], 0);
        assert_eq!(value["totalPages"], 1);
    }

    #[test]
    fn empty_task_page_defaults_archived_and_rejects_invalid_boundaries() {
        let value = dispatch_invoke("task:list-page", &[json!({ "page": 1, "pageSize": 50 })])
            .expect("page should default archived");
        assert_eq!(value["archived"], false);

        for request in [
            json!({ "archived": "false", "page": 1, "pageSize": 10 }),
            json!({ "page": 0, "pageSize": 10 }),
            json!({ "page": 1.5, "pageSize": 10 }),
            json!({ "page": 1, "pageSize": 51 }),
        ] {
            assert!(dispatch_invoke("task:list-page", &[request]).is_err());
        }
    }

    #[test]
    fn confirm_without_pending_request_is_rejected() {
        let state = DesktopState::default();
        let error = state
            .confirm_close_with(|| Ok(()))
            .expect_err("idle confirm must fail");
        assert!(error.contains("没有待确认"));
        assert_eq!(state.close_state(), CloseState::Idle);
    }

    #[test]
    fn cancel_clears_pending_request_before_confirm() {
        let state = DesktopState::default();
        assert_eq!(state.on_close_requested(), CloseRequestAction::Emit);
        state.cancel_close();
        assert_eq!(state.close_state(), CloseState::Idle);
        assert!(state.confirm_close_with(|| Ok(())).is_err());
    }

    #[test]
    fn close_handshake_completes_one_cycle_without_duplicate_events() {
        let state = DesktopState::default();
        assert_eq!(state.on_close_requested(), CloseRequestAction::Emit);
        assert_eq!(state.on_close_requested(), CloseRequestAction::Prevent);
        state
            .confirm_close_with(|| Ok(()))
            .expect("pending request should be approved");
        assert_eq!(state.close_state(), CloseState::Approved);
        assert_eq!(state.on_close_requested(), CloseRequestAction::Allow);
        assert_eq!(state.close_state(), CloseState::Idle);
        assert_eq!(state.on_close_requested(), CloseRequestAction::Emit);
    }

    #[test]
    fn close_handshake_restores_idle_after_emit_lookup_or_close_failure() {
        let state = DesktopState::default();
        assert_eq!(state.on_close_requested(), CloseRequestAction::Emit);
        state.restore_pending_after_emit_failure();
        assert_eq!(state.close_state(), CloseState::Idle);

        for error in ["Tauri 主窗口不存在。", "关闭窗口失败。"] {
            assert_eq!(state.on_close_requested(), CloseRequestAction::Emit);
            assert_eq!(
                state
                    .confirm_close_with(|| Err(error.to_owned()))
                    .expect_err("native close failure must propagate"),
                error
            );
            assert_eq!(state.close_state(), CloseState::Idle);
        }
    }

    #[test]
    fn allowlisted_but_unimplemented_channel_is_explicit() {
        let error = dispatch_invoke("workspace:select", &[]).expect_err("must be unsupported");
        assert!(error.contains("尚未实现"));
    }
}
