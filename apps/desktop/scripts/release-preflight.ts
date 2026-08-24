/**
 * [INPUT]: Electron Vite 编译后的主进程入口，可随包分发的原生依赖，以及正式发行时的版本、Tag 与签名环境
 * [OUTPUT]: 阻止主进程遗留未分发的运行时依赖、工作区源码泄漏或不完整签名的打包前检查
 * [POS]: Electron Builder 启动前的发行边界守卫
 * [DOC]: docs/architecture/release.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { assertAlphaReleaseContract } from "./release-contract"
import { builtinModules } from "node:module"

const mainEntry = Bun.file(new URL("../out/main/index.js", import.meta.url))
if (!(await mainEntry.exists())) throw new Error("缺少主进程构建产物，请先运行 bun run build。")

const source = await mainEntry.text()
const allowedRuntimeImports = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "better-sqlite3",
  "electron",
])
const unresolvedRuntimeImports = new Set<string>()

for (const line of source.split("\n")) {
  const staticImport = line.match(/^\s*import(?:\s+.+?\s+from)?\s*["']([^"']+)["'];?\s*$/u)
  const specifier = staticImport?.[1]
  if (specifier && !specifier.startsWith(".") && !allowedRuntimeImports.has(specifier)) {
    unresolvedRuntimeImports.add(specifier)
  }
}

if (unresolvedRuntimeImports.size > 0) {
  throw new Error(`主进程仍包含未分发的运行时依赖：${[...unresolvedRuntimeImports].join(", ")}`)
}

if (Bun.argv.includes("--release")) {
  const desktopPackage = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    version?: unknown
  }
  const rootPackage = (await Bun.file(new URL("../../../package.json", import.meta.url)).json()) as {
    version?: unknown
  }
  const desktopVersion = typeof desktopPackage.version === "string" ? desktopPackage.version : ""
  const rootVersion = typeof rootPackage.version === "string" ? rootPackage.version : ""

  assertAlphaReleaseContract({
    desktopVersion,
    environment: process.env,
    rootVersion,
    tag: process.env.GITHUB_REF_NAME ?? process.env.RELEASE_TAG,
  })

  const appleApiKey = process.env.APPLE_API_KEY ?? ""
  const appleApiKeyFile = Bun.file(appleApiKey)
  if (!(await appleApiKeyFile.exists()) || appleApiKeyFile.size === 0) {
    throw new Error("APPLE_API_KEY 必须指向非空的 App Store Connect API 私钥文件。")
  }
  if (!(await appleApiKeyFile.text()).includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("APPLE_API_KEY 指向的文件不是有效的 App Store Connect API 私钥。")
  }

  const appIcon = Bun.file(new URL("../build/icon.icns", import.meta.url))
  if (!(await appIcon.exists()) || appIcon.size === 0) {
    throw new Error("正式发行缺少 apps/desktop/build/icon.icns，拒绝发布 Electron 默认图标。")
  }

  console.log(`正式发行预检通过：v${desktopVersion} 将使用 Developer ID 签名并提交 Apple 公证。`)
} else {
  console.log("内部构建预检通过：主进程没有未分发的运行时依赖。")
}
