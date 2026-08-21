/**
 * [INPUT]: Electron Vite 编译后的主进程入口
 * [OUTPUT]: 阻止工作区 TypeScript 包泄漏到发行运行时的打包前检查
 * [POS]: Electron Builder 启动前的发行边界守卫
 * [DOC]: README.md、apps/desktop/electron-builder.yml
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

const mainEntry = Bun.file(new URL("../out/main/index.js", import.meta.url))
if (!(await mainEntry.exists())) throw new Error("缺少主进程构建产物，请先运行 bun run build。")

const source = await mainEntry.text()
const workspaceRuntimeImport = source.match(/(?:from\s+|import\()\s*["'](@tessera\/[^"']+)["']/u)

if (workspaceRuntimeImport) {
  throw new Error(`主进程仍包含未打包的工作区运行时依赖：${workspaceRuntimeImport[1]}`)
}

console.log("发行预检通过：主进程没有外部工作区运行时依赖。")
