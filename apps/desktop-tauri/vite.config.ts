/**
 * [INPUT]: Tauri 启动入口、Electron 应用持有的共享 renderer、React 与 Tailwind Vite 插件
 * [OUTPUT]: 允许跨应用读取同一 renderer 且不复制组件的 Tauri WebView 构建
 * [POS]: Tauri 对照壳的前端构建入口
 * [DOC]: docs/architecture/tauri-parity.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const appRoot = fileURLToPath(new URL(".", import.meta.url))
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url))
const sharedReact = fileURLToPath(new URL("./node_modules/react", import.meta.url))
const sharedReactDom = fileURLToPath(new URL("./node_modules/react-dom", import.meta.url))

export default defineConfig({
  root: appRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    // 跨目录加载 renderer 时仍固定使用 Tauri 壳直接声明的同一份 React，避免双实例。
    alias: {
      react: sharedReact,
      "react-dom": sharedReactDom,
    },
  },
  server: {
    fs: {
      allow: [workspaceRoot],
    },
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    emptyOutDir: true,
    outDir: "dist",
    target: "safari15",
  },
})
