/**
 * [INPUT]: 隐式执行模式/创作方式的任务快照、可选工作区/当前文档草稿、页面或侧栏表面、导航回调、AI 模型与 Electron useChat Transport
 * [OUTPUT]: 主任务与文档侧栏共用的首次发送懒创建、显式文档上下文、自动能力策略、流式恢复、Agent Diff 审批和持续保存会话表面
 * [POS]: Tessera 主任务页与文档 AI 侧栏共用的单一对话实现
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type AiModelExecution, aiModelExecutionIssueMessage, resolveAiModelExecution } from "@tessera/ai"
import { type UIMessage, hasPendingTaskUserInput, toTaskMessages, useElectronChat } from "@tessera/ai/react"
import {
  type AiChatReasoning,
  type DocumentSnapshot,
  REQUEST_USER_INPUT_TOOL_NAME,
  type TaskMessage,
  type TaskSessionStatus,
} from "@tessera/contracts"
import { PanelLeftOpenIcon, Settings01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@tessera/design-system/components/ui/message-scroller"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type AvailableAiModel, useAiModels } from "../hooks/use-ai-models"
import type { ActiveTask } from "../hooks/use-tasks"
import { ChatMessage } from "./chat-message"
import { aiModelKey } from "./model-picker"
import { type ComposerImage, TaskComposer } from "./task-composer"

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_CONTEXT_DOCUMENT_BYTES = 256 * 1024

type TaskPageProps = Readonly<{
  active: boolean
  currentDocument?: DocumentSnapshot | null
  currentDocumentContent?: string | undefined
  defaultAttachCurrentDocument?: boolean
  surface?: "page" | "sidebar"
  task: ActiveTask
  taskError: string | null
  sidebarOpen: boolean
  workspaceName: string | null
  onEnsureTask: (title: string) => Promise<unknown | null>
  onPersistTask: (messages: TaskMessage[], status: TaskSessionStatus) => Promise<unknown | null>
  onSkillChange: (skillId: ActiveTask["skillId"]) => void
  onOpenDocument?: ((path: string, line?: number) => void) | undefined
  onToggleSidebar: () => void
  onOpenSettings: () => void
}>

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取图片。")),
    )
    reader.addEventListener("error", () => reject(new Error("无法读取图片。")))
    reader.readAsDataURL(file)
  })
}

function markdownDataUrl(content: string) {
  const bytes = new TextEncoder().encode(content)
  let binary = ""
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768))
  }
  return `data:text/markdown;base64,${btoa(binary)}`
}

export function resolveAutomaticTaskExecution(
  skillId: ActiveTask["skillId"],
  mode: ActiveTask["mode"],
  model: AvailableAiModel | undefined,
): AiModelExecution | null {
  if (!model) return null
  const resolve = (webSearch: boolean) =>
    resolveAiModelExecution({
      baseUrl: model.baseUrl,
      mode,
      model,
      providerId: model.providerId,
      webSearch,
    })
  if (skillId === "question-answering") return resolve(false)

  const onlineExecution = resolve(true)
  if (skillId === "research" || onlineExecution.issues.length === 0) return onlineExecution
  return resolve(false)
}

function automaticReasoning(
  skillId: ActiveTask["skillId"],
  execution: AiModelExecution | null,
): AiChatReasoning {
  if (skillId === "question-answering") return "auto"
  return execution?.capabilities.reasoning === "supported" ? "high" : "auto"
}

function taskTitle(prompt: string, images: ComposerImage[]) {
  const firstLine = prompt.trim().split(/\r?\n/u)[0]?.trim()
  if (firstLine) return firstLine.slice(0, 48)
  const filename = images[0]?.filename.replace(/\.[^.]+$/u, "")
  return filename?.slice(0, 48) || "新任务"
}

function lastTaskModelKey(messages: readonly TaskMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const metadata = messages[index]?.metadata
    if (metadata?.configId && metadata.modelId) return `${metadata.configId}::${metadata.modelId}`
  }
  return null
}

function taskStatus(
  status: "ready" | "submitted" | "streaming" | "error",
  messages: Parameters<typeof hasPendingTaskUserInput>[0],
): TaskSessionStatus {
  if (status === "submitted" || status === "streaming") return "running"
  if (status === "error") return "failed"
  if (hasPendingTaskUserInput(messages)) return "waiting-input"
  return "completed"
}

function shouldOmitRunningAssistantTail(message: UIMessage | undefined) {
  if (!message || message.role !== "assistant") return false
  if (message.parts.length === 0) return true
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") return part.state === "streaming"
    if ((part.type === "dynamic-tool" || part.type.startsWith("tool-")) && "state" in part) {
      return part.state === "input-streaming" || part.state === "input-available"
    }
    return false
  })
}

export function TaskPage({
  active,
  currentDocument = null,
  currentDocumentContent,
  defaultAttachCurrentDocument = false,
  surface = "page",
  task,
  taskError,
  sidebarOpen,
  workspaceName,
  onEnsureTask,
  onPersistTask,
  onSkillChange,
  onOpenDocument,
  onToggleSidebar,
  onOpenSettings,
}: TaskPageProps) {
  const { models, refresh: refreshModels } = useAiModels()
  const [selectedModelKey, setSelectedModelKey] = useState("")
  const [prompt, setPrompt] = useState("")
  const [images, setImages] = useState<ComposerImage[]>([])
  const [documentAttached, setDocumentAttached] = useState(
    () => defaultAttachCurrentDocument && Boolean(currentDocument),
  )
  const [notice, setNotice] = useState("")
  const selectedModel = useMemo(
    () => models.find((model) => aiModelKey(model) === selectedModelKey),
    [models, selectedModelKey],
  )
  const execution = useMemo(
    () => resolveAutomaticTaskExecution(task.skillId, task.mode, selectedModel),
    [selectedModel, task.mode, task.skillId],
  )
  const reasoning = automaticReasoning(task.skillId, execution)
  const webSearch = execution?.searchRoute === "provider-native"
  const researchReady = execution?.issues.length === 0 && execution.capabilities.reasoning === "supported"
  const researchNotice =
    task.skillId === "research" && !researchReady
      ? "研究模式需要支持深度思考与联网搜索的模型，请更换模型。"
      : ""
  const executionNotice = execution?.issues[0] ? aiModelExecutionIssueMessage(execution.issues[0]) : ""
  const documentContext =
    documentAttached && currentDocument
      ? { filename: currentDocument.name, relativePath: currentDocument.relativePath }
      : null
  const chat = useElectronChat({
    bridge: window.tessera,
    chatId: task.id,
    configId: selectedModel?.configId ?? "",
    ...(documentContext ? { currentDocumentPath: documentContext.relativePath } : {}),
    initialMessages: task.messages,
    mode: task.mode,
    skillId: task.skillId,
    providerId: selectedModel?.providerId ?? "openai-compatible",
    modelId: selectedModel?.id ?? "",
    reasoning,
    webSearch,
  })
  const running = chat.status === "submitted" || chat.status === "streaming"
  const waitingForInput = hasPendingTaskUserInput(chat.messages)
  const lastPersistedRef = useRef(`${task.status}:${JSON.stringify(task.messages)}`)
  const loadAgentChangePreview = useCallback(
    (approvalId: string) => {
      if (!window.tessera) return Promise.reject(new Error("桌面 Agent 服务不可用。"))
      return window.tessera.readAgentChangePreview(task.id, approvalId)
    },
    [task.id],
  )

  useEffect(() => {
    if (active) void refreshModels()
  }, [active, refreshModels])

  useEffect(() => {
    if (selectedModel) return
    const previousModelKey = lastTaskModelKey(task.messages)
    const previousModel = models.find((model) => aiModelKey(model) === previousModelKey)
    setSelectedModelKey(previousModel ? aiModelKey(previousModel) : models[0] ? aiModelKey(models[0]) : "")
  }, [models, selectedModel, task.messages])

  useEffect(() => {
    if (!selectedModel?.inputModalities?.includes("image")) setImages([])
  }, [selectedModel])

  const previousDocumentPathRef = useRef(currentDocument?.relativePath)
  useEffect(() => {
    const nextPath = currentDocument?.relativePath
    if (defaultAttachCurrentDocument && nextPath && nextPath !== previousDocumentPathRef.current) {
      setDocumentAttached(true)
    }
    previousDocumentPathRef.current = nextPath
  }, [currentDocument?.relativePath, defaultAttachCurrentDocument])

  useEffect(() => {
    if (!task.persisted || chat.messages.length === 0) return
    const snapshots = toTaskMessages(
      chat.messages,
      selectedModel
        ? {
            configId: selectedModel.configId,
            modelId: selectedModel.id,
            providerId: selectedModel.providerId,
          }
        : undefined,
    )
    const status = taskStatus(chat.status, chat.messages)
    const messages =
      status === "running" && shouldOmitRunningAssistantTail(chat.messages.at(-1))
        ? snapshots.slice(0, -1)
        : snapshots
    const identity = `${status}:${JSON.stringify(messages)}`
    if (identity === lastPersistedRef.current) return
    const timer = window.setTimeout(
      () => {
        lastPersistedRef.current = identity
        void onPersistTask(messages, status)
      },
      running ? 500 : 120,
    )
    return () => window.clearTimeout(timer)
  }, [chat.messages, chat.status, onPersistTask, running, selectedModel, task.persisted])

  const addImages = async (files: FileList) => {
    const availableSlots = MAX_IMAGES - images.length
    const selectedFiles = [...files].slice(0, availableSlots)
    const invalidType = selectedFiles.find((file) => !ACCEPTED_IMAGE_TYPES.has(file.type))
    const oversized = selectedFiles.find((file) => file.size > MAX_IMAGE_BYTES)
    if (invalidType) {
      setNotice("当前仅支持 PNG、JPEG、WebP 和 GIF 图片。")
      return
    }
    if (oversized) {
      setNotice("单张图片不能超过 8 MB。")
      return
    }
    try {
      const nextImages = await Promise.all(
        selectedFiles.map(async (file) => ({
          id: globalThis.crypto.randomUUID(),
          filename: file.name,
          mediaType: file.type,
          url: await fileDataUrl(file),
        })),
      )
      setImages((current) => [...current, ...nextImages].slice(0, MAX_IMAGES))
      setNotice(files.length > availableSlots ? `一次最多添加 ${MAX_IMAGES} 张图片。` : "")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取图片失败。")
    }
  }

  const send = async () => {
    if (!selectedModel || running || (!prompt.trim() && images.length === 0)) return
    if (waitingForInput) {
      setNotice("请先回答上方的问题，或选择跳过，任务随后会继续。")
      return
    }
    if (researchNotice) {
      setNotice(researchNotice)
      return
    }
    if (task.mode === "agent" && !workspaceName) {
      setNotice("Agent 任务必须在工作区中运行，请先打开工作区。")
      return
    }
    if (executionNotice) {
      setNotice(executionNotice)
      return
    }
    const text = prompt
    const files = images.map((image) => ({
      type: "file" as const,
      url: image.url,
      mediaType: image.mediaType,
      filename: image.filename,
    }))
    if (documentContext) {
      const content = currentDocumentContent ?? currentDocument?.content ?? ""
      if (new TextEncoder().encode(content).byteLength > MAX_CONTEXT_DOCUMENT_BYTES) {
        setNotice("当前文档超过 256 KiB，暂时无法直接加入对话上下文。")
        return
      }
      files.push({
        type: "file" as const,
        url: markdownDataUrl(content),
        mediaType: "text/markdown",
        filename: documentContext.relativePath,
      })
    }
    setPrompt("")
    setImages([])
    setNotice("")
    const persistedTask = await onEnsureTask(taskTitle(text, images))
    if (!persistedTask) {
      setNotice("无法创建当前任务。")
      setPrompt(text)
      setImages(images)
      return
    }
    void chat
      .sendMessage({ text, files })
      .then(() => setDocumentAttached(false))
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "发送消息失败。")
        setPrompt(text)
        setImages(images)
      })
  }

  const agentNotice =
    task.mode === "agent" && !workspaceName ? "Agent 任务必须在工作区中运行，请先打开工作区。" : ""
  const agentScope =
    task.mode === "agent" && workspaceName
      ? `范围：工作区「${workspaceName}」中的 Markdown；写入必须先看 Diff 并批准。`
      : ""
  const composerNotice =
    notice ||
    (waitingForInput ? "当前任务正在等待你的回答。" : "") ||
    researchNotice ||
    agentNotice ||
    executionNotice ||
    chat.error?.message ||
    taskError ||
    ""

  const composer = (compact = false) => (
    <TaskComposer
      agentMode={task.mode === "agent"}
      agentReady={Boolean(workspaceName) && execution?.agentReady === true}
      availableDocument={
        currentDocument
          ? { filename: currentDocument.name, relativePath: currentDocument.relativePath }
          : null
      }
      compact={compact || surface === "sidebar"}
      documentContext={documentContext}
      value={prompt}
      images={images}
      models={models}
      model={selectedModel}
      selectedModelKey={selectedModelKey}
      skillId={task.skillId}
      status={chat.status}
      notice={composerNotice}
      scope={agentScope}
      onChange={(value) => {
        setPrompt(value)
        if (notice) setNotice("")
      }}
      onAddImages={(files) => void addImages(files)}
      onAddCurrentDocument={() => {
        const content = currentDocumentContent ?? currentDocument?.content ?? ""
        if (new TextEncoder().encode(content).byteLength > MAX_CONTEXT_DOCUMENT_BYTES) {
          setNotice("当前文档超过 256 KiB，暂时无法直接加入对话上下文。")
          return
        }
        setDocumentAttached(true)
        setNotice("")
      }}
      onRemoveDocumentContext={() => setDocumentAttached(false)}
      onRemoveImage={(id) => setImages((current) => current.filter((image) => image.id !== id))}
      onModelChange={setSelectedModelKey}
      onSkillChange={onSkillChange}
      onSubmit={() => void send()}
      onStop={() => void chat.stop()}
    />
  )

  return (
    <section
      className={`flex h-full min-h-0 flex-col ${surface === "sidebar" ? "bg-sidebar/35" : "bg-background"}`}
    >
      {surface === "page" ? (
        <header
          className="app-drag-region window-titlebar-leading relative flex h-12 shrink-0 items-center pr-3"
          data-sidebar-open={sidebarOpen}
        >
          <div className="app-no-drag flex min-w-8 items-center">
            {!sidebarOpen ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="展开侧边栏"
                title="展开侧边栏"
                onClick={onToggleSidebar}
              >
                <Icon icon={PanelLeftOpenIcon} size={15} />
              </Button>
            ) : null}
          </div>
          <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium">
            {task.title}
          </span>
          <div className="app-no-drag ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="打开设置"
              title="设置"
              onClick={onOpenSettings}
            >
              <Icon icon={Settings01Icon} size={15} />
            </Button>
          </div>
        </header>
      ) : null}

      {chat.messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={`mx-auto flex min-h-full w-full flex-col items-center justify-center ${surface === "sidebar" ? "px-3 py-5" : "max-w-3xl px-6 py-14 pb-24"}`}
          >
            <div className={surface === "sidebar" ? "mb-4 text-center" : "mb-7 text-center"}>
              <h1
                className={
                  surface === "sidebar" ? "text-sm font-medium" : "text-xl font-semibold tracking-tight"
                }
              >
                {surface === "sidebar" ? "围绕当前文档协作" : "今天想做点什么？"}
              </h1>
              <p
                className={`${surface === "sidebar" ? "mt-1 text-xs leading-5" : "mt-1.5 text-sm"} text-muted-foreground`}
              >
                {surface === "sidebar"
                  ? "提问、研究或修改，可把当前文档作为可见附件发送。"
                  : "研究、阅读、理解与写作，从一个问题开始。"}
              </p>
            </div>
            {composer()}
          </div>
        </div>
      ) : (
        <>
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport
                className={surface === "sidebar" ? "px-3" : "px-5"}
                aria-label="对话消息"
              >
                <MessageScrollerContent
                  className={`mx-auto w-full ${surface === "sidebar" ? "gap-5 py-4 pb-7" : "max-w-3xl gap-8 py-8 pb-12"}`}
                >
                  {chat.messages.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <ChatMessage
                        message={message}
                        isLast={index === chat.messages.length - 1}
                        running={running}
                        loadAgentChangePreview={loadAgentChangePreview}
                        onOpenDocument={onOpenDocument}
                        onRegenerate={() => void chat.regenerate()}
                        onToolApproval={(id, approved) =>
                          chat.addToolApprovalResponse({
                            id,
                            approved,
                            ...(!approved ? { reason: "用户拒绝了这次文档更改。" } : {}),
                          })
                        }
                        onUserInput={(toolCallId, output) =>
                          chat.addToolOutput({
                            tool: REQUEST_USER_INPUT_TOOL_NAME,
                            toolCallId,
                            output,
                          })
                        }
                      />
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
          <div
            className={`shrink-0 bg-gradient-to-t from-background via-background to-transparent pt-3 ${surface === "sidebar" ? "px-3 pb-3" : "px-5 pb-4"}`}
          >
            <div className={surface === "sidebar" ? "w-full" : "mx-auto w-full max-w-3xl"}>
              {composer(true)}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
