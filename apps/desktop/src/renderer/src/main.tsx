/**
 * [INPUT]: React DOM、顶级 App、编辑器基准查询参数与全局样式
 * [OUTPUT]: 正常 React 应用或隔离的编辑器性能基准入口
 * [POS]: Electron 渲染层的产品与基准路由边界
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import "./styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("缺少 Tessera 的 root 挂载节点")

const benchmark = new URLSearchParams(window.location.search).get("benchmark")
if (benchmark === "editor") {
  const benchmarkPromise = import("./benchmarks/editor-benchmark").then(({ runEditorBenchmark }) =>
    runEditorBenchmark(root),
  )
  Object.assign(globalThis, { __TESSERA_EDITOR_BENCHMARK__: benchmarkPromise })
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
