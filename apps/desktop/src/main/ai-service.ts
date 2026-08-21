/**
 * [INPUT]: Electron safeStorage、SQLite 数据库客户端和跨进程 AI 配置/对话输入
 * [OUTPUT]: 不暴露密钥的配置读写、模型目录连接解析与已授权对话运行时输入
 * [POS]: 桌面主进程内的平台安全存储、数据库仓储和 @tessera/ai 领域层适配器
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type AiChatRuntimeInput,
  AiProviderConfigError,
  type AiProviderConfigService,
  type AiProviderConfigStore,
  createAiProviderConfigService,
} from "@tessera/ai/server"
import type {
  AiChatStartInput,
  AiProviderConfig,
  AiProviderConnectionInput,
  AiProviderId,
  AiProviderSaveInput,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  deleteAiProviderConfigRecord,
  findAiProviderConfigRecord,
  listAiProviderConfigRecords,
  upsertAiProviderConfigRecord,
} from "@tessera/database"
import { safeStorage } from "electron"

export interface DesktopAiService {
  deleteConfig(providerId: AiProviderId): void
  listConfigs(): AiProviderConfig[]
  resolveChatInput(input: AiChatStartInput): AiChatRuntimeInput
  resolveDiscoveryConnection(input: AiProviderConnectionInput): AiProviderConnectionInput
  saveConfig(input: AiProviderSaveInput): AiProviderConfig
}

function databaseStore(client: DatabaseClient): AiProviderConfigStore {
  const toStoreRecord = (record: ReturnType<typeof findAiProviderConfigRecord>) =>
    record ? { ...record, updatedAt: record.updatedAt.getTime() } : null

  return {
    find: (providerId) => toStoreRecord(findAiProviderConfigRecord(client, providerId)),
    list: () =>
      listAiProviderConfigRecords(client).map((record) => ({
        ...record,
        updatedAt: record.updatedAt.getTime(),
      })),
    save: (record) =>
      upsertAiProviderConfigRecord(client, { ...record, updatedAt: new Date(record.updatedAt) }),
    delete: (providerId) => deleteAiProviderConfigRecord(client, providerId),
  }
}

function createConfigService(client: DatabaseClient): AiProviderConfigService {
  return createAiProviderConfigService({
    store: databaseStore(client),
    secretStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value)),
    },
  })
}

export function createDesktopAiService(client: DatabaseClient): DesktopAiService {
  const configs = createConfigService(client)

  return {
    listConfigs: () => configs.listConfigs(),
    saveConfig: (input) => configs.saveConfig(input),
    deleteConfig: (providerId) => configs.deleteConfig(providerId),
    resolveDiscoveryConnection: (input) => configs.resolveConnection(input),
    resolveChatInput: (input) => {
      const config = configs.listConfigs().find((candidate) => candidate.providerId === input.providerId)
      if (!config?.enabled) throw new AiProviderConfigError("请先在设置中启用这个 AI 供应商。")
      if (!config.apiKeyConfigured) throw new AiProviderConfigError("请先为这个供应商保存 API Key。")
      const model = config.models.find((candidate) => candidate.id === input.modelId)
      if (!model?.enabled) throw new AiProviderConfigError("所选模型未启用，请在供应商设置中检查模型列表。")
      if (input.webSearch && model.capabilities?.search !== "supported") {
        throw new AiProviderConfigError("所选模型没有已验证的联网搜索能力。")
      }
      if (
        input.reasoning !== "auto" &&
        input.reasoning !== "none" &&
        model.capabilities?.reasoning !== "supported"
      ) {
        throw new AiProviderConfigError("所选模型没有已验证的可控思考能力。")
      }
      if (
        input.messages.some((message) => message.parts.some((part) => part.type === "file")) &&
        model.capabilities?.imageInput === "unsupported"
      ) {
        throw new AiProviderConfigError("所选模型不支持图片输入。")
      }

      const connection = configs.resolveConnection({
        providerId: config.providerId,
        baseUrl: config.baseUrl,
        apiKey: "",
      })
      return { ...input, ...connection }
    },
  }
}
