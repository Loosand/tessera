/**
 * [INPUT]: 桌面 bridge 提供的宿主/运行时信息、Motion 特性与产品级 AppShell
 * [OUTPUT]: 尊重系统减少动态效果偏好的 Tessera 桌面渲染入口
 * [POS]: 渲染层根组件，负责加载全局应用信息与动效运行时
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo } from "@tessera/contracts"
import { LazyMotion, MotionConfig, domAnimation } from "motion/react"
import { useEffect, useState } from "react"
import { AppShell } from "./components/app-shell"

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo>()

  useEffect(() => {
    const desktopApi = window.tessera
    if (!desktopApi) return

    let active = true
    void desktopApi.getAppInfo().then((value) => {
      if (active) setAppInfo(value)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <AppShell appInfo={appInfo} />
      </MotionConfig>
    </LazyMotion>
  )
}
