# macOS Alpha 发行

> 代码源头：`.github/workflows/release-alpha.yml`、`apps/desktop/electron-builder.yml`、
> `apps/desktop/scripts/release-contract.ts`、`apps/desktop/scripts/release-preflight.ts`
>
> 状态：部分实现。可重复发行流水线、公共源码仓库和正式品牌图标已就绪；Apple Secrets 与首个 Release 尚未配置或执行。

## 发行范围

首个公开候选版本使用 `0.1.0-alpha.n`，只产出 Apple Silicon macOS 的 DMG 与 ZIP。DMG 面向手动安装，ZIP
保留为轻量分发产物；当前应用尚未接入自动更新，因此用户需要手动安装后续 Alpha。

应用版本以 `apps/desktop/package.json` 为打包事实源，并与根 `package.json` 保持一致。正式发行 Tag 必须精确等于
`v${version}`，例如版本 `0.1.0-alpha.1` 只能由 `v0.1.0-alpha.1` 触发。已发布 Tag 不移动、不覆盖；修复使用新的
`alpha.n`。

## 两条构建路径

```text
bun run dist:mac
  -> 本机内部验证
  -> 显式 ad-hoc 签名
  -> 禁止 Apple 公证

bun run dist:mac:release
  -> 正式 Alpha 发行
  -> 强制 Alpha 版本与 Tag 一致
  -> 强制 Developer ID 凭据
  -> 强制 App Store Connect API 私钥
  -> Electron Builder 签名并提交 Apple 公证
```

正式路径不会在凭据不全时降级成 ad-hoc 产物。`release-preflight.ts --release` 会在 Electron Builder 前验证版本、
Tag、环境变量、有效 `.p8` 私钥和正式 `build/icon.icns`；签名、公证或 Gatekeeper 验证失败都会终止 Workflow，
不创建 Release。

## GitHub Secrets

仓库 Actions 需要以下 Secrets：

| 名称 | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | 带私钥的 Developer ID Application `.p12`，使用 Base64 或 electron-builder 支持的安全链接 |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码 |
| `APPLE_API_KEY_BASE64` | App Store Connect API `.p8` 文件的 Base64 内容 |
| `APPLE_API_KEY_ID` | App Store Connect API Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |

Workflow 只把 `.p8` 解码到 GitHub runner 的临时目录并设置为仅当前用户可读；密钥不进入 Git、日志、应用包或
Release。正式 Job 只授予 `contents: write`，使用当前仓库的短时 `GITHUB_TOKEN` 创建 Pre-release。

## 托管流水线

推送 `v*-alpha.*` Tag 后，`.github/workflows/release-alpha.yml` 在 ARM64 `macos-15` runner 上依次执行：

1. 使用锁定的 Bun 版本和 `bun.lock` 安装依赖；
2. 运行 `bun run check`；
3. 解码临时公证私钥并执行正式发行预检；
4. 构建、Developer ID 签名并提交 Apple 公证；
5. 使用 `codesign`、Gatekeeper 和 `stapler` 验证应用；
6. 为 DMG 和 ZIP 生成 `SHA256SUMS.txt`；
7. 创建非 Latest 的 GitHub Pre-release，上传全部三个文件并自动生成变更说明。

## 公共下载边界

GitHub Release 继承仓库可见性。`Loosand/tessera` 已设为 Public，因此成功发布的 Pre-release 可由任何人直接下载。
公开源码尚未添加许可证；许可证会决定其他人复制、修改和分发源码的权利，必须在正式宣传为“开源”前由维护者明确选择。
Workflow 不会自行选择许可证或改变仓库可见性。

正式预检要求 `apps/desktop/build/icon.icns` 存在，避免 Electron 默认图标进入公开 Release。当前图标由版本化的
`build/icon.png` 主稿生成，并通过 `electron-builder.yml` 显式接入 macOS 打包。

## 首次发布检查

- 在干净的 Apple Silicon Mac 用户账号中，从 GitHub 下载 DMG 并安装；
- 确认 Finder、Dock、DMG 和应用窗口使用最终 Tessera 图标；
- 确认 Gatekeeper 显示已识别的开发者且不要求绕过安全设置；
- 确认未配置供应商时能进入设置，配置后能完成一次普通问答；
- 确认创建工作区、编辑 Markdown、重启恢复、Diff 拒绝与批准均正常；
- 对比下载文件与 `SHA256SUMS.txt`；
- Release Notes 标明 Alpha、系统架构、已知限制、数据备份和问题反馈入口。

首发出现问题时撤回 Release，并发布递增的 `alpha.n`；不修改已发布资产或重新指向旧 Tag。
