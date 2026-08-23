/**
 * [INPUT]: SQLite 客户端、持久化的研究网络偏好与跨进程 ResearchNetworkMode 契约
 * [OUTPUT]: 默认 system、只接受 system/direct 的研究网络模式读写边界
 * [POS]: 设置 IPC 与每次研究运行之间的应用级网络策略服务
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type ResearchNetworkMode, isResearchNetworkMode } from "@tessera/contracts"
import { type DatabaseClient, findAppSetting, upsertAppSetting } from "@tessera/database"

const RESEARCH_NETWORK_MODE_KEY = "research-network-mode"

export const DEFAULT_RESEARCH_NETWORK_MODE = "system" satisfies ResearchNetworkMode

export function readResearchNetworkMode(client: DatabaseClient): ResearchNetworkMode {
  const value = findAppSetting(client, RESEARCH_NETWORK_MODE_KEY)?.value
  return isResearchNetworkMode(value) ? value : DEFAULT_RESEARCH_NETWORK_MODE
}

export function saveResearchNetworkMode(client: DatabaseClient, mode: ResearchNetworkMode) {
  if (!isResearchNetworkMode(mode)) throw new Error("研究网络模式无效。")
  upsertAppSetting(client, {
    key: RESEARCH_NETWORK_MODE_KEY,
    value: mode,
    updatedAt: new Date(),
  })
  return mode
}
