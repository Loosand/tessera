/**
 * [INPUT]: 带执行模式/Skill 的任务快照、可选工作区/当前文档、视图激活状态、侧栏/设置/文件跳转回调、AI 模型与 Electron useChat Transport
 * [OUTPUT]: 首次发送懒创建、Skill 驱动、客户端问答暂停/恢复、后台生成恢复、Agent 授权范围、Diff 审批与持续保存的多轮流式任务页面
 * [POS]: Tessera 主导航中的普通 Chat 与工作区 Agent 共用任务表面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type UIMessage,
  hasPendingTaskUserInput,
  toTaskMessages,
  useElectronChat,
} from "@tessera/ai/react"
import {
  REQUEST_USER_INPUT_TOOL_NAME,
  type AiChatReasoning,
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
import { useAiModels } from "../hooks/use-ai-models"
import type { ActiveTask } from "../hooks/use-tasks"
import { ChatMessage } from "./chat-message"
import { aiModelKey } from "./model-picker"
import { type ComposerImage, TaskComposer } from "./task-composer"

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

interface TaskPageProps {
  active: boolean
  currentDocumentPath?: string | undefined
  task: ActiveTask
  taskError: string | null
  sidebarOpen: boolean
  workspaceName: string | null
  onEnsureTask: (title: string) => Promise<unknown | null>
  onPersistTask: (messages: TaskMessage[], status: TaskSessionStatus) => Promise<unknown | null>
  onModeChange: (mode: ActiveTask["mode"]) => void
  onSkillChange: (skillId: ActiveTask["skillId"]) => void
  onOpenDocument?: ((path: string, line?: number) => void) | undefined
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

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

function taskTitle(prompt: string, images: ComposerImage[]) {
  const firstLine = prompt.trim().split(/\r?\n/u)[0]?.trim()
  if (firstLine) return firstLine.slice(0, 48)
  const filename = images[0]?.filename.replace(/\.[^.]+$/u, "")
  return filename?.slice(0, 48) || "新任务"
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
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      return part.state === "input-streaming" || part.state === "input-available"
    }
    return false
  })
}

export function TaskPage({
  active,
  currentDocumentPath,
  task,
  taskError,
  sidebarOpen,
  workspaceName,
  onEnsureTask,
  onPersistTask,
  onModeChange,
  onSkillChange,
  onOpenDocument,
  onToggleSidebar,
  onOpenSettings,
}: TaskPageProps) {
  const { models, refresh: refreshModels } = useAiModels()
  const [selectedModelKey, setSelectedModelKey] = useState("")
  const [prompt, setPrompt] = useState("")
  const [images, setImages] = useState<ComposerImage[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [reasoning, setReasoning] = useState<AiChatReasoning>("auto")
  const [notice, setNotice] = useState("")
  const selectedModel = useMemo(
    () => models.find((model) => aiModelKey(model) === selectedModelKey),
    [models, selectedModelKey],
  )
  const chat = useElectronChat({
    bridge: window.tessera,
    chatId: task.id,
    configId: selectedModel?.configId ?? "",
    currentDocumentPath,
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
    setSelectedModelKey(models[0] ? aiModelKey(models[0]) : "")
  }, [models, selectedModel])

  useEffect(() => {
    if (!selectedModel) return
    if (task.mode === "agent" || selectedModel.capabilities?.search !== "supported") setWebSearch(false)
    if (selectedModel.capabilities?.reasoning !== "supported") setReasoning("auto")
    if (selectedModel.capabilities?.imageInput === "unsupported") setImages([])
  }, [selectedModel, task.mode])

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
    if (task.mode === "agent" && !workspaceName) {
      setNotice("Agent 任务必须在工作区中运行，请先打开工作区。")
      return
    }
    if (task.mode === "agent" && selectedModel.capabilities?.toolUse !== "supported") {
      setNotice("当前模型没有已验证的工具调用能力，请选择支持工具的模型。")
      return
    }
    const text = prompt
    const files = images.map((image) => ({
      type: "file" as const,
      url: image.url,
      mediaType: image.mediaType,
      filename: image.filename,
    }))
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
    void chat.sendMessage({ text, files }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "发送消息失败。")
      setPrompt(text)
      setImages(images)
    })
  }

  const agentNotice =
    task.mode === "agent" && !workspaceName
      ? "Agent 任务必须在工作区中运行，请先打开工作区。"
      : task.mode === "agent" && selectedModel?.capabilities?.toolUse !== "supported"
        ? "当前模型没有已验证的工具调用能力，请选择支持工具的模型。"
        : ""
  const agentScope =
    task.mode === "agent" && workspaceName
      ? `范围：工作区「${workspaceName}」中的 Markdown；写入必须先看 Diff 并批准，不含删除、Shell 或联网工具。`
      : ""
  const composerNotice =
    notice ||
    (waitingForInput ? "当前任务正在等待你的回答。" : "") ||
    agentNotice ||
    chat.error?.message ||
    taskError ||
    ""

  const composer = (compact = false) => (
    <TaskComposer
      agentReady={Boolean(workspaceName)}
      compact={compact}
      value={prompt}
      images={images}
      models={models}
      model={selectedModel}
      selectedModelKey={selectedModelKey}
      reasoning={reasoning}
      mode={task.mode}
      modeLocked={task.persisted || chat.messages.length > 0}
      skillId={task.skillId}
      skillLocked={task.persisted || chat.messages.length > 0}
      webSearch={webSearch}
      status={chat.status}
      notice={composerNotice}
      scope={agentScope}
      onChange={(value) => {
        setPrompt(value)
        if (notice) setNotice("")
      }}
      onAddImages={(files) => void addImages(files)}
      onRemoveImage={(id) => setImages((current) => current.filter((image) => image.id !== id))}
      onModelChange={setSelectedModelKey}
      onModeChange={onModeChange}
      onSkillChange={onSkillChange}
      onReasoningChange={setReasoning}
      onWebSearchChange={setWebSearch}
      onSubmit={() => void send()}
      onStop={() => void chat.stop()}
    />
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
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

      {chat.messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-6 py-14 pb-24">
            <div className="mb-7 text-center">
              <h1 className="text-xl font-semibold tracking-tight">今天想做点什么？</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">研究、阅读、理解与写作，从一个问题开始。</p>
            </div>
            {composer()}
          </div>
        </div>
      ) : (
        <>
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport className="px-5" aria-label="对话消息">
                <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-8 py-8 pb-12">
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
          <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-5 pt-3 pb-4">
            <div className="mx-auto w-full max-w-3xl">{composer(true)}</div>
          </div>
        </>
      )}
    </section>
  )
}
