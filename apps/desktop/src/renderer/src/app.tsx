/**
 * [INPUT]: 共享领域数据、共享 UI 组件与预加载层提供的桌面 API
 * [OUTPUT]: 桌面渲染层的顶级 App 组件
 * [POS]: 组合桌面产品区域的当前应用壳层
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo } from "@tessera/contracts"
import { PRODUCT_AREAS } from "@tessera/core"
import { CapabilityCard } from "@tessera/ui"
import { useEffect, useState } from "react"

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo>()

  useEffect(() => {
    let active = true
    void window.tessera.getAppInfo().then((value) => {
      if (active) setAppInfo(value)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
        <div>
          <p className="eyebrow">Local-first reading workspace</p>
          <h1>Tessera</h1>
          <p className="intro">
            Read what you own, connect what matters, and keep the result as durable Markdown.
          </p>
        </div>
      </header>

      <section className="capability-grid" aria-label="Tessera product areas">
        {PRODUCT_AREAS.map((area) => (
          <CapabilityCard
            key={area.id}
            title={area.title}
            description={area.description}
            status={area.status}
          />
        ))}
      </section>

      <footer>
        <span>{appInfo ? `${appInfo.name} ${appInfo.version}` : "Starting local core…"}</span>
        <span>{appInfo?.platform ?? "secure renderer"}</span>
      </footer>
    </main>
  )
}
