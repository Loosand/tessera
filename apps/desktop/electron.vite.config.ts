import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          "@modelcontextprotocol/sdk",
          "@tessera/agent-runtime",
          "@tessera/ai",
          "@tessera/contracts",
          "@tessera/core",
          "@tessera/database",
          "@tessera/skills",
          "parse5",
        ],
      },
      rollupOptions: {
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ["@tessera/contracts"],
      },
      rollupOptions: {
        external: ["electron"],
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
})
