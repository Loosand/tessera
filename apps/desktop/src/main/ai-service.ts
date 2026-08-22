/**
 * [INPUT]: Electron safeStorage、SQLite 数据库客户端和跨进程 AI 配置/Chat/Agent 输入
 * [OUTPUT]: 不暴露密钥的配置读写、模型目录连接解析与按实际端点收窄能力的运行时输入
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
  aiModelExecutionIssueMessage,
  createAiProviderConfigService,
  resolveAiModelExecution,
} from "@tessera/ai/server"
import type {
  AiChatStartInput,
  AiProviderConfig,
  AiProviderConnectionInput,
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

export type DesktopAiService = {
  readonly deleteConfig: (configId: string) => void
  readonly listConfigs: () => AiProviderConfig[]
  readonly resolveChatInput: (input: AiChatStartInput) => AiChatRuntimeInput
  readonly resolveDiscoveryConnection: (input: AiProviderConnectionInput) => AiProviderConnectionInput
  readonly saveConfig: (input: AiProviderSaveInput) => AiProviderConfig
}

function databaseStore(client: DatabaseClient): AiProviderConfigStore {
  const toStoreRecord = (record: ReturnType<typeof findAiProviderConfigRecord>) =>
    record ? { ...record, updatedAt: record.updatedAt.getTime() } : null

  return {
    find: (configId) => toStoreRecord(findAiProviderConfigRecord(client, configId)),
    list: () =>
      listAiProviderConfigRecords(client).map((record) => ({
        ...record,
        updatedAt: record.updatedAt.getTime(),
      })),
    save: (record) =>
      upsertAiProviderConfigRecord(client, { ...record, updatedAt: new Date(record.updatedAt) }),
    delete: (configId) => deleteAiProviderConfigRecord(client, configId),
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
    deleteConfig: (configId) => configs.deleteConfig(configId),
    resolveDiscoveryConnection: (input) => configs.resolveConnection(input),
    resolveChatInput: (input) => {
      const config = configs.listConfigs().find((candidate) => candidate.configId === input.configId)
      if (config?.providerId !== input.providerId) {
        throw new AiProviderConfigError("所选连接与供应商协议不匹配。")
      }
      if (!config?.enabled) throw new AiProviderConfigError("请先在设置中启用这个 AI 供应商。")
      if (!config.apiKeyConfigured) throw new AiProviderConfigError("请先为这个供应商保存 API Key。")
      const model = config.models.find((candidate) => candidate.id === input.modelId)
      if (!model?.enabled) throw new AiProviderConfigError("所选模型未启用，请在供应商设置中检查模型列表。")
      const execution = resolveAiModelExecution({
        baseUrl: config.baseUrl,
        mode: input.mode,
        model,
        providerId: config.providerId,
        webSearch: input.webSearch,
      })
      const issue = execution.issues[0]
      if (issue) {
        throw new AiProviderConfigError(aiModelExecutionIssueMessage(issue))
      }
      if (
        input.reasoning !== "auto" &&
        input.reasoning !== "none" &&
        execution.capabilities.reasoning !== "supported"
      ) {
        throw new AiProviderConfigError("所选模型没有已验证的可控思考能力。")
      }
      if (
        input.messages.some((message) =>
          message.parts.some((part) => part.type === "file" && part.mediaType.startsWith("image/")),
        ) &&
        !execution.model.inputModalities?.includes("image")
      ) {
        throw new AiProviderConfigError("所选模型不支持图片输入。")
      }

      const connection = configs.resolveConnection({
        configId: config.configId,
        providerId: config.providerId,
        baseUrl: config.baseUrl,
        apiKey: "",
      })
      if (!execution.endpointType) throw new AiProviderConfigError("当前模型没有可用的生成端点。")
      return { ...input, ...connection, endpointType: execution.endpointType }
    },
  }
}
