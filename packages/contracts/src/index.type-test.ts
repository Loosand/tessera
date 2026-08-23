/**
 * [INPUT]: DesktopApiContract、默认空间、研究网络模式、统一 RunPolicy、用户 Skill 标识、托管内容库、Artifact 与后端无关内容引用及其泛型查询工具
 * [OUTPUT]: 编译期类型等价与错误用例，防止默认空间/研究网络 IPC、运行/工具错误、方法关系和内容领域边界退化
 * [POS]: contracts 包的零运行时类型回归测试
 * [DOC]: docs/architecture.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { IPC_CHANNELS } from "./index"
import type {
  AI_PROVIDER_IDS,
  AiChatStartInput,
  AiChatStartResult,
  AiProviderId,
  ArtifactRef,
  ContentLibraryResult,
  DesktopApiArguments,
  DesktopApiChannel,
  DesktopApiContract,
  DesktopApiMethod,
  DesktopApiMethodByChannel,
  DesktopApiMethodByKind,
  DesktopApiReturn,
  DocumentSnapshot,
  IpcChannel,
  McpServerConfig,
  OperationResult,
  ResearchNetworkMode,
  ResourceBinding,
  TaskArtifact,
  TaskFollowUpQuestionsDataV1,
  TaskMessageData,
  TaskMessageFeedback,
  TaskMessageMetadata,
  TaskResearchNotebook,
  TaskResearchSaveSourcesResult,
  TaskRunErrorDataV1,
  TaskRunInspection,
  TaskRunPolicy,
  TaskSessionPage,
  TaskSessionPageRequest,
  TaskSessionSummary,
  TaskSkillId,
  TaskToolErrorDataV1,
  UserTaskSkillId,
} from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false

type Expect<Value extends true> = Value

export type DesktopApiContractTypeTests = [
  Expect<Equal<(typeof AI_PROVIDER_IDS)[number], AiProviderId>>,
  Expect<Equal<DesktopApiArguments<"readDocument">, [relativePath: string]>>,
  Expect<Equal<DesktopApiReturn<"readDocument">, Promise<DocumentSnapshot>>>,
  Expect<Equal<DesktopApiChannel<"readDocument">, typeof IPC_CHANNELS.documentRead>>,
  Expect<Equal<DesktopApiContract[DesktopApiMethod]["channel"], IpcChannel>>,
  Expect<Equal<Extract<DesktopApiMethodByKind<"send">, "cancelAiChat">, "cancelAiChat">>,
  Expect<Equal<Extract<DesktopApiMethodByKind<"subscribe">, "onAiChatEvent">, "onAiChatEvent">>,
  Expect<Equal<DesktopApiMethodByChannel<typeof IPC_CHANNELS.documentRead, "invoke">, "readDocument">>,
  Expect<Equal<DesktopApiReturn<"listMcpServers">, Promise<McpServerConfig[]>>>,
  Expect<Equal<DesktopApiChannel<"testMcpServer">, typeof IPC_CHANNELS.mcpServerTest>>,
  Expect<Equal<Extract<DesktopApiMethodByKind<"subscribe">, "onMcpServersChanged">, "onMcpServersChanged">>,
  Expect<Equal<DesktopApiChannel<"installUserSkill">, typeof IPC_CHANNELS.userSkillInstall>>,
  Expect<Equal<DesktopApiChannel<"scanUserSkills">, typeof IPC_CHANNELS.userSkillScan>>,
  Expect<Equal<DesktopApiChannel<"installScannedUserSkills">, typeof IPC_CHANNELS.userSkillInstallScanned>>,
  Expect<Equal<Extract<TaskSkillId, UserTaskSkillId>, UserTaskSkillId>>,
  Expect<Equal<Extract<OperationResult, { ok: true }>["ok"], true>>,
  Expect<Equal<Extract<keyof AiChatStartInput, "reasoning" | "webSearch">, never>>,
  Expect<Equal<Extract<AiChatStartResult, { ok: false }>["error"], TaskRunErrorDataV1>>,
  Expect<Equal<TaskMessageData["tool-error"], TaskToolErrorDataV1>>,
  Expect<Equal<TaskMessageData["follow-up-questions"], TaskFollowUpQuestionsDataV1>>,
  Expect<Equal<TaskMessageMetadata["feedback"], TaskMessageFeedback | undefined>>,
  Expect<Equal<TaskRunPolicy["toolScope"], "conversation" | "workspace-read" | "workspace-write">>,
  Expect<Equal<ArtifactRef["relation"], "created" | "imported" | "updated">>,
  Expect<Equal<ResourceBinding["role"], "context" | "output" | "scope">>,
  Expect<Equal<DesktopApiReturn<"getCurrentContentLibrary">, Promise<ContentLibraryResult>>>,
  Expect<Equal<DesktopApiReturn<"listTaskArtifacts">, Promise<TaskArtifact[]>>>,
  Expect<Equal<DesktopApiReturn<"openDefaultWorkspace">, Promise<null>>>,
  Expect<Equal<DesktopApiReturn<"listDefaultTasks">, Promise<TaskSessionSummary[]>>>,
  Expect<Equal<DesktopApiArguments<"listTasksPage">, [request: TaskSessionPageRequest]>>,
  Expect<Equal<DesktopApiReturn<"listTasksPage">, Promise<TaskSessionPage>>>,
  Expect<Equal<DesktopApiReturn<"readTaskRun">, Promise<TaskRunInspection | null>>>,
  Expect<Equal<DesktopApiArguments<"readTaskRun">, [taskId: string, requestId: string]>>,
  Expect<Equal<DesktopApiReturn<"getResearchNetworkMode">, Promise<ResearchNetworkMode>>>,
  Expect<Equal<DesktopApiArguments<"setResearchNetworkMode">, [mode: ResearchNetworkMode]>>,
  Expect<Equal<DesktopApiArguments<"readResearchNotebook">, [taskId: string, requestId: string]>>,
  Expect<Equal<DesktopApiReturn<"readResearchNotebook">, Promise<TaskResearchNotebook | null>>>,
  Expect<
    Equal<
      DesktopApiArguments<"saveResearchSources">,
      [taskId: string, requestId: string, sourceIds: string[]]
    >
  >,
  Expect<Equal<DesktopApiReturn<"saveResearchSources">, Promise<TaskResearchSaveSourcesResult>>>,
]

// @ts-expect-error readDocument 只能接收一个相对路径参数。
export type InvalidReadDocumentArguments = DesktopApiArguments<"readDocument">[1]
