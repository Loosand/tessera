/**
 * [INPUT]: 隐式执行模式/创作方式的任务快照、可选工作区/当前文档草稿、Artifact、页面或侧栏表面、导航回调、AI 模型与 Electron useChat/运行解释桥
 * [OUTPUT]: 主任务与独立文档对话侧栏共用的 Space 落地页、作用域最近任务、首次发送懒创建、无误保存的历史恢复、首帧定位到最新消息、显式文档上下文、Artifact 导航、同源 RunPolicy 预检、整轮计时/常驻运行反馈、流式恢复、引申问题带入、本地消息反馈、按需运行解释、Agent Diff 审批和持续保存会话表面
 * [POS]: Tessera 主任务页与文档 AI 侧栏共用的单一对话实现
 * [DOC]: design.md、docs/architecture/unified-creation-agent.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type AiModelExecution,
  type TaskRunPolicyResolution,
  resolveTaskRunPolicy,
  taskRunPolicyIssueMessage,
} from "@tessera/ai"
import {
  type UIMessage,
  hasPendingTaskUserInput,
  hasTaskRunError,
  isUIMessageToolPart,
  toTaskMessages,
  useElectronChat,
} from "@tessera/ai/react"
import {
  type DocumentSnapshot,
  REQUEST_USER_INPUT_TOOL_NAME,
  type TaskArtifact,
  type TaskMessage,
  type TaskMessageFeedbackRating,
  type TaskResearchSaveSourcesResult,
  type TaskSessionStatus,
  type TaskSessionSummary,
} from "@tessera/contracts"
import {
  CheckmarkCircle02Icon,
  Folder01Icon,
  Home05Icon,
  PanelLeftOpenIcon,
  Settings01Icon,
} from "@tessera/design-system/components/icons"
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  type AvailableAiModel,
  readPreferredAiModelKey,
  rememberPreferredAiModelKey,
  useAiModels,
} from "../hooks/use-ai-models"
import type { ActiveTask } from "../hooks/use-tasks"
import { ChatMessage } from "./chat-message"
import { TaskRunStatus, type TaskRunTiming } from "./chat-parts/task-run-activity"
import { aiModelKey } from "./model-picker"
import { TaskArtifactTray } from "./task-artifact-tray"
import { type ComposerImage, TaskComposer } from "./task-composer"

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_CONTEXT_DOCUMENT_BYTES = 256 * 1024

function monotonicNow() {
  return typeof performance === "undefined" ? 0 : performance.now()
}

function useTaskRunTiming(taskId: string, running: boolean) {
  const previousRef = useRef({ running: false, taskId })
  const [state, setState] = useState<Readonly<{ taskId: string; timing: TaskRunTiming | null }>>({
    taskId,
    timing: running ? { startedAt: monotonicNow(), completedAt: null } : null,
  })

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = { running, taskId }

    if (previous.taskId !== taskId) {
      setState({
        taskId,
        timing: running ? { startedAt: monotonicNow(), completedAt: null } : null,
      })
      return
    }
    if (running && !previous.running) {
      setState({ taskId, timing: { startedAt: monotonicNow(), completedAt: null } })
      return
    }
    if (!running && previous.running) {
      const completedAt = monotonicNow()
      setState((current) => ({
        taskId,
        timing:
          current.taskId === taskId && current.timing
            ? { ...current.timing, completedAt }
            : { startedAt: completedAt, completedAt },
      }))
    }
  }, [running, taskId])

  return state.taskId === taskId ? state.timing : null
}

type TaskPageProps = Readonly<{
  currentDocument?: DocumentSnapshot | null
  currentDocumentContent?: string | undefined
  defaultAttachCurrentDocument?: boolean
  surface?: "page" | "sidebar"
  task: ActiveTask
  taskError: string | null
  recentTasks?: readonly TaskSessionSummary[]
  sidebarOpen: boolean
  workspaceName: string | null
  onEnsureTask: (title: string) => Promise<unknown | null>
  onPersistTask: (messages: TaskMessage[], status: TaskSessionStatus) => Promise<unknown | null>
  onSkillChange: (skillId: ActiveTask["skillId"]) => void
  onOpenArtifact?: ((artifact: TaskArtifact) => void) | undefined
  onOpenDocument?: ((path: string, line?: number) => void) | undefined
  onOpenRecentTask?: ((task: TaskSessionSummary) => void) | undefined
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
  return resolveAutomaticTaskRunPolicy(skillId, mode, model)?.execution ?? null
}

export function resolveAutomaticTaskRunPolicy(
  skillId: ActiveTask["skillId"],
  mode: ActiveTask["mode"],
  model: AvailableAiModel | undefined,
): TaskRunPolicyResolution | null {
  if (!model) return null
  return resolveTaskRunPolicy({
    baseUrl: model.baseUrl,
    mode,
    model,
    providerId: model.providerId,
    skillId,
  })
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

export function withTaskMessageFeedback(
  messages: readonly UIMessage[],
  messageId: string,
  rating: TaskMessageFeedbackRating | null,
  updatedAt = Date.now(),
): UIMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || message.role !== "assistant") return message
    const metadata = message.metadata ?? {}
    if (rating) {
      return { ...message, metadata: { ...metadata, feedback: { rating, updatedAt } } }
    }
    if (!metadata.feedback) return message
    const { feedback: _removedFeedback, ...remainingMetadata } = metadata
    const { metadata: _removedMetadata, ...messageWithoutMetadata } = message
    return Object.keys(remainingMetadata).length > 0
      ? { ...messageWithoutMetadata, metadata: remainingMetadata }
      : messageWithoutMetadata
  })
}

type TaskPersistenceAction = "initialize" | "skip" | "persist"

export function resolveTaskPersistenceAction(input: {
  readonly activityObserved: boolean
  readonly currentChatIdentity: string
  readonly initialChatIdentity: string
  readonly nextPersistenceIdentity: string
  readonly previousPersistenceIdentity: string | null
}): TaskPersistenceAction {
  if (!input.activityObserved && input.currentChatIdentity === input.initialChatIdentity) {
    return "initialize"
  }
  return input.previousPersistenceIdentity === input.nextPersistenceIdentity ? "skip" : "persist"
}

function taskStatus(
  status: "ready" | "submitted" | "streaming" | "error",
  messages: Parameters<typeof hasPendingTaskUserInput>[0],
): TaskSessionStatus {
  if (status === "submitted" || status === "streaming") return "running"
  if (status === "error") return "failed"
  if (hasPendingTaskUserInput(messages)) return "waiting-input"
  if (hasTaskRunError(messages)) return "failed"
  return "completed"
}

function shouldOmitRunningAssistantTail(message: UIMessage | undefined) {
  if (!message || message.role !== "assistant") return false
  if (message.parts.length === 0) return true
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") return part.state === "streaming"
    if (isUIMessageToolPart(part)) {
      return part.state === "input-streaming" || part.state === "input-available"
    }
    return false
  })
}

export function TaskPage({
  currentDocument = null,
  currentDocumentContent,
  defaultAttachCurrentDocument = false,
  surface = "page",
  task,
  taskError,
  recentTasks = [],
  sidebarOpen,
  workspaceName,
  onEnsureTask,
  onPersistTask,
  onSkillChange,
  onOpenArtifact,
  onOpenDocument,
  onOpenRecentTask,
  onToggleSidebar,
  onOpenSettings,
}: TaskPageProps) {
  const { loading: modelsLoading, models } = useAiModels()
  const [selectedModelKey, setSelectedModelKey] = useState(() => {
    const taskModelKey = lastTaskModelKey(task.messages)
    if (taskModelKey) return taskModelKey
    const preferredModelKey = readPreferredAiModelKey()
    return preferredModelKey || (models[0] ? aiModelKey(models[0]) : "")
  })
  const [prompt, setPrompt] = useState("")
  const [images, setImages] = useState<ComposerImage[]>([])
  const [documentAttached, setDocumentAttached] = useState(
    () => defaultAttachCurrentDocument && Boolean(currentDocument),
  )
  const [notice, setNotice] = useState("")
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([])
  const selectedModel = useMemo(
    () => models.find((model) => aiModelKey(model) === selectedModelKey),
    [models, selectedModelKey],
  )
  const runtimeMode = workspaceName ? "agent" : "chat"
  const policyResolution = useMemo(
    () => resolveAutomaticTaskRunPolicy(task.skillId, runtimeMode, selectedModel),
    [runtimeMode, selectedModel, task.skillId],
  )
  const execution = policyResolution?.execution ?? null
  const researchReady = policyResolution?.issues.length === 0
  const researchNotice =
    task.skillId === "research" && !researchReady
      ? "研究方式需要支持深度思考与联网搜索的模型，请更换模型。"
      : ""
  const executionNotice = policyResolution?.issues[0]
    ? taskRunPolicyIssueMessage(policyResolution.issues[0])
    : ""
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
    mode: runtimeMode,
    skillId: task.skillId,
    providerId: selectedModel?.providerId ?? "openai-compatible",
    modelId: selectedModel?.id ?? "",
    resume: task.persisted,
  })
  const running = chat.status === "submitted" || chat.status === "streaming"
  const runTiming = useTaskRunTiming(task.id, running)
  const waitingForInput = hasPendingTaskUserInput(chat.messages)
  const initialChatIdentityRef = useRef(JSON.stringify(chat.messages))
  const taskActivityObservedRef = useRef(false)
  const lastPersistedRef = useRef<string | null>(null)
  const messageViewportRef = useRef<HTMLDivElement | null>(null)
  const [messageViewportReady, setMessageViewportReady] = useState(task.messages.length === 0)
  const loadAgentChangePreview = useCallback(
    (approvalId: string) => {
      if (!window.tessera) return Promise.reject(new Error("桌面 Agent 服务不可用。"))
      return window.tessera.readAgentChangePreview(task.id, approvalId)
    },
    [task.id],
  )
  const readResearchNotebook = useCallback(
    (requestId: string) => {
      if (!window.tessera) return Promise.reject(new Error("桌面研究服务不可用。"))
      return window.tessera.readResearchNotebook(task.id, requestId)
    },
    [task.id],
  )
  const readTaskRun = useCallback(
    (requestId: string) => {
      if (!window.tessera) return Promise.reject(new Error("桌面运行日志服务不可用。"))
      return window.tessera.readTaskRun(task.id, requestId)
    },
    [task.id],
  )
  const saveResearchRecommendations = useCallback(
    async (requestId: string, sourceIds: string[]): Promise<TaskResearchSaveSourcesResult> => {
      if (!window.tessera) return { ok: false, error: "桌面研究服务不可用。" }
      const result = await window.tessera.saveResearchSources(task.id, requestId, sourceIds)
      const artifact = result.ok ? result.artifact : null
      if (artifact) {
        setArtifacts((current) => [artifact, ...current.filter((candidate) => candidate.id !== artifact.id)])
      }
      return result
    },
    [task.id],
  )

  useEffect(() => {
    const desktopApi = window.tessera
    if (!desktopApi || !task.persisted || running) return
    let cancelled = false
    void desktopApi
      .listTaskArtifacts(task.id)
      .then((nextArtifacts) => {
        if (!cancelled) setArtifacts(nextArtifacts)
      })
      .catch(() => {
        if (!cancelled) setArtifacts([])
      })
    return () => {
      cancelled = true
    }
  }, [running, task.id, task.persisted])

  useEffect(() => {
    if (selectedModel) return
    const previousModelKey = lastTaskModelKey(task.messages)
    const previousModel = models.find((model) => aiModelKey(model) === previousModelKey)
    const preferredModelKey = readPreferredAiModelKey()
    const preferredModel = models.find((model) => aiModelKey(model) === preferredModelKey)
    const nextModel = previousModel ?? preferredModel ?? models[0]
    setSelectedModelKey(nextModel ? aiModelKey(nextModel) : "")
  }, [models, selectedModel, task.messages])

  const selectModel = useCallback((key: string) => {
    setSelectedModelKey(key)
    rememberPreferredAiModelKey(key)
  }, [])

  const useFollowUpQuestion = useCallback((value: string) => {
    setPrompt(value)
    setNotice("")
  }, [])

  const updateMessageFeedback = useCallback(
    (messageId: string, rating: TaskMessageFeedbackRating | null) => {
      chat.setMessages((messages) => withTaskMessageFeedback(messages, messageId, rating))
    },
    [chat.setMessages],
  )

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
    const action = resolveTaskPersistenceAction({
      activityObserved: taskActivityObservedRef.current,
      currentChatIdentity: JSON.stringify(chat.messages),
      initialChatIdentity: initialChatIdentityRef.current,
      nextPersistenceIdentity: identity,
      previousPersistenceIdentity: lastPersistedRef.current,
    })
    if (action === "initialize") {
      lastPersistedRef.current = identity
      return
    }
    taskActivityObservedRef.current = true
    if (action === "skip") return
    const timer = window.setTimeout(
      () => {
        lastPersistedRef.current = identity
        void onPersistTask(messages, status)
      },
      running ? 500 : 120,
    )
    return () => window.clearTimeout(timer)
  }, [chat.messages, chat.status, onPersistTask, running, selectedModel, task.persisted])

  useLayoutEffect(() => {
    if (messageViewportReady || task.messages.length === 0) return
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight
      setMessageViewportReady(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messageViewportReady, task.messages.length])

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

  const agentScope = workspaceName
    ? `范围：工作区「${workspaceName}」中的 Markdown；写入必须先看 Diff 并批准。`
    : ""
  const composerNotice =
    notice ||
    (waitingForInput ? "当前任务正在等待你的回答。" : "") ||
    researchNotice ||
    executionNotice ||
    taskError ||
    ""

  const composer = (compact = false) => (
    <TaskComposer
      agentMode={Boolean(workspaceName)}
      agentReady={execution?.agentReady === true}
      availableDocument={
        currentDocument
          ? { filename: currentDocument.name, relativePath: currentDocument.relativePath }
          : null
      }
      compact={compact || surface === "sidebar"}
      documentContext={documentContext}
      value={prompt}
      images={images}
      modelLoading={modelsLoading}
      models={models}
      model={selectedModel}
      selectedModelKey={selectedModelKey}
      skillId={task.skillId}
      status={chat.status}
      notice={composerNotice}
      placeholder={chat.messages.length > 0 ? "继续提问…" : "描述你想完成的任务…"}
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
      onModelChange={selectModel}
      onSkillChange={onSkillChange}
      onSubmit={() => void send()}
      onStop={() => void chat.stop()}
    />
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
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
          {chat.messages.length > 0 ? (
            <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium">
              {task.title}
            </span>
          ) : null}
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

      {chat.messages.length === 0 && surface === "sidebar" ? (
        <>
          <div className="min-h-0 flex-1" />
          <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-3 pt-3 pb-3">
            {composer(true)}
          </div>
        </>
      ) : chat.messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto min-h-full w-full max-w-[600px] px-2 pb-16">
            <div className="flex min-h-[56vh] flex-col items-center justify-end pb-10">
              <div className="mb-5 flex h-8 max-w-60 items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-[11px] font-medium shadow-xs">
                <Icon icon={workspaceName ? Folder01Icon : Home05Icon} size={14} />
                <span className="truncate">{workspaceName ?? "默认空间"}</span>
              </div>
              <div className="mb-7 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">今天想做点什么？</h1>
              </div>
              {composer()}
            </div>

            {recentTasks.length > 0 && onOpenRecentTask ? (
              <section aria-labelledby="space-recent-tasks-title">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 id="space-recent-tasks-title" className="text-[12px] font-medium">
                    最近任务
                  </h2>
                  <span className="text-[10px] text-muted-foreground">{recentTasks.length} 个</span>
                </div>
                <div className="grid gap-1">
                  {recentTasks.slice(0, 5).map((recentTask) => (
                    <button
                      key={recentTask.id}
                      type="button"
                      className="flex h-9 w-full items-center gap-2 rounded-xl bg-muted/70 px-3 text-left transition-colors hover:bg-muted"
                      onClick={() => onOpenRecentTask(recentTask)}
                    >
                      <Icon icon={CheckmarkCircle02Icon} size={15} className="shrink-0 text-foreground/55" />
                      <span className="min-w-0 flex-1 truncate text-[12px]">{recentTask.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport
                ref={messageViewportRef}
                className={`${surface === "sidebar" ? "px-3" : "px-5"} ${messageViewportReady ? "" : "invisible"}`}
                aria-label="对话消息"
                aria-busy={!messageViewportReady}
              >
                <MessageScrollerContent
                  className={`mx-auto w-full ${surface === "sidebar" ? "gap-5 py-4 pb-8" : "max-w-[600px] gap-7 pt-9 pb-16"}`}
                >
                  {chat.messages.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                      className={messageViewportReady ? undefined : "[content-visibility:visible]"}
                    >
                      <ChatMessage
                        message={message}
                        isLast={index === chat.messages.length - 1}
                        running={running}
                        runTiming={index === chat.messages.length - 1 ? runTiming : null}
                        loadAgentChangePreview={loadAgentChangePreview}
                        onFeedback={updateMessageFeedback}
                        onOpenDocument={onOpenDocument}
                        onRegenerate={() => void chat.regenerate({ messageId: message.id })}
                        onReadResearchNotebook={readResearchNotebook}
                        onReadTaskRun={readTaskRun}
                        onSaveResearchRecommendations={saveResearchRecommendations}
                        onUseFollowUpQuestion={running ? undefined : useFollowUpQuestion}
                        onToolApproval={(id, approved) =>
                          chat.addToolApprovalResponse({
                            id,
                            approved,
                            ...(!approved ? { reason: "用户拒绝了这次操作。" } : {}),
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
                  {onOpenArtifact && artifacts.length > 0 ? (
                    <div className="pt-1">
                      <TaskArtifactTray
                        artifacts={artifacts}
                        compact={surface === "sidebar"}
                        onOpen={onOpenArtifact}
                      />
                    </div>
                  ) : null}
                  {running ? (
                    <div className="pt-1">
                      <TaskRunStatus />
                    </div>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
          <div
            className={`shrink-0 bg-gradient-to-t from-background from-70% via-background/95 to-transparent pt-5 ${surface === "sidebar" ? "px-3 pb-3" : "px-5 pb-4"}`}
          >
            <div className={surface === "sidebar" ? "w-full" : "mx-auto w-full max-w-[600px]"}>
              {composer(true)}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
