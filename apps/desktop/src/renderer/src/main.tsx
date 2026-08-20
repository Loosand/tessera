/**
 * [INPUT]: React DOM、顶级 App 组件与全局样式
 * [OUTPUT]: 挂载到 HTML root 节点的 React 应用
 * [POS]: Electron 渲染层的 React 启动入口
 * [DOC]: design.md
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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
