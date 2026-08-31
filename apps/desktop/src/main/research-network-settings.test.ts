/**
 * [INPUT]: 内存 SQLite 与研究网络模式读写服务
 * [OUTPUT]: system 默认值、direct 持久化与损坏配置回退的回归验证
 * [POS]: 研究网络策略服务的单元测试
 * [DOC]: docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { openDatabase, upsertAppSetting } from "@tessera/database"
import { describe, expect, test } from "vitest"
import {
  DEFAULT_RESEARCH_NETWORK_MODE,
  readResearchNetworkMode,
  saveResearchNetworkMode,
} from "./research-network-settings"

describe("研究网络设置", () => {
  test("默认跟随系统代理并可持久化直连选择", () => {
    const client = openDatabase({ path: ":memory:" })
    expect(readResearchNetworkMode(client)).toBe(DEFAULT_RESEARCH_NETWORK_MODE)
    expect(saveResearchNetworkMode(client, "direct")).toBe("direct")
    expect(readResearchNetworkMode(client)).toBe("direct")
    client.close()
  })

  test("损坏的旧配置不会绕过允许模式", () => {
    const client = openDatabase({ path: ":memory:" })
    upsertAppSetting(client, {
      key: "research-network-mode",
      value: "custom-proxy",
      updatedAt: new Date(100),
    })
    expect(readResearchNetworkMode(client)).toBe("system")
    client.close()
  })
})
