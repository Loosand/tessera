/**
 * [INPUT]: 视图激活状态、侧栏/设置回调、自动同步 AI 模型、Electron useChat Transport 与本地输入草稿
 * [OUTPUT]: 从居中新任务输入平滑进入可脱离贴底阅读的多轮流式对话页面
 * [POS]: Tessera 主导航中的普通对话与后续 Agent 共用任务表面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { useElectronChat } from "@tessera/ai/react"
import type { AiChatReasoning } from "@tessera/contracts"
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
import { useEffect, useMemo, useState } from "react"
import { useAiModels } from "../hooks/use-ai-models"
import { ChatMessage } from "./chat-message"
import { aiModelKey } from "./model-picker"
import { type ComposerImage, TaskComposer } from "./task-composer"

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

interface TaskPageProps {
  active: boolean
  sidebarOpen: boolean
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

export function TaskPage({ active, sidebarOpen, onToggleSidebar, onOpenSettings }: TaskPageProps) {
  const { error: modelError, loading, models, refresh: refreshModels } = useAiModels()
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
    providerId: selectedModel?.providerId ?? "openai-compatible",
    modelId: selectedModel?.id ?? "",
    reasoning,
    webSearch,
  })
  const running = chat.status === "submitted" || chat.status === "streaming"

  useEffect(() => {
    if (active) void refreshModels()
  }, [active, refreshModels])

  useEffect(() => {
    if (selectedModel) return
    setSelectedModelKey(models[0] ? aiModelKey(models[0]) : "")
  }, [models, selectedModel])

  useEffect(() => {
    if (!selectedModel) return
    if (selectedModel.capabilities?.search !== "supported") setWebSearch(false)
    if (selectedModel.capabilities?.reasoning !== "supported") setReasoning("auto")
    if (selectedModel.capabilities?.imageInput === "unsupported") setImages([])
  }, [selectedModel])

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

  const send = () => {
    if (!selectedModel || running || (!prompt.trim() && images.length === 0)) return
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
    void chat.sendMessage({ text, files }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "发送消息失败。")
      setPrompt(text)
      setImages(images)
    })
  }

  const composerNotice =
    notice ||
    chat.error?.message ||
    modelError ||
    (loading ? "正在读取可用模型…" : models.length === 0 ? "请先在设置中保存并启用一个供应商与模型。" : "")

  const composer = (compact = false) => (
    <TaskComposer
      compact={compact}
      value={prompt}
      images={images}
      models={models}
      model={selectedModel}
      selectedModelKey={selectedModelKey}
      reasoning={reasoning}
      webSearch={webSearch}
      status={chat.status}
      notice={composerNotice}
      onChange={(value) => {
        setPrompt(value)
        if (notice) setNotice("")
      }}
      onAddImages={(files) => void addImages(files)}
      onRemoveImage={(id) => setImages((current) => current.filter((image) => image.id !== id))}
      onModelChange={setSelectedModelKey}
      onReasoningChange={setReasoning}
      onWebSearchChange={setWebSearch}
      onSubmit={send}
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
          {chat.messages.length > 0 ? selectedModel?.name || selectedModel?.id || "新任务" : "新任务"}
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
            {models.length === 0 && !loading ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={onOpenSettings}>
                配置模型供应商
              </Button>
            ) : null}
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
                        onRegenerate={() => void chat.regenerate()}
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
