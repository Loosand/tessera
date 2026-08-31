/**
 * [INPUT]: Markdown 草稿、文档身份、激活/拼写状态与草稿同步注册回调
 * [OUTPUT]: CodeMirror 6 Markdown 源码表面、文档级历史、IME 安全同步与行号导航
 * [POS]: 长文档和源码优先语法的高性能编辑表面
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { indentWithTab } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { Compartment, EditorSelection, EditorState, type Extension, Transaction } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import {
  SOURCE_EDITOR_NAVIGATE_EVENT,
  type SourceEditorSessionSnapshot,
  clampSourceEditorSession,
  consumePendingSourceEditorLine,
  isSourceEditorNavigateEvent,
  normalizeSourceEditorLine,
} from "./source-code-editor-state"

type SourceCodeEditorProps = {
  readonly active: boolean
  readonly content: string
  readonly documentName: string
  readonly documentPath: string
  readonly spellCheck: boolean
  readonly onContentChange: (documentPath: string, content: string) => void
  readonly onFlushPendingEditsReady: (flush: (() => void) | null) => void
}

const SOURCE_EDITOR_THEME = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontFamily: "var(--editor-typeset-font-mono, var(--font-mono))",
    fontSize: "var(--editor-font-size, 16px)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--foreground)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "var(--editor-typeset-leading, 1.7)",
    overflow: "auto",
    tabSize: "2",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "3rem clamp(24px, 6vw, 64px) 40vh",
    caretColor: "var(--foreground)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    border: "none",
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    paddingLeft: "0.5rem",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--muted) 68%, transparent)",
  },
  ".cm-foldPlaceholder": {
    border: "1px solid var(--border)",
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
  },
  ".cm-tooltip, .cm-panels": {
    borderColor: "var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
  },
})

const SOURCE_EDITOR_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.heading, color: "var(--foreground)", fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--link)", textDecoration: "underline" },
  { tag: [tags.comment, tags.meta, tags.quote], color: "var(--muted-foreground)" },
  { tag: [tags.keyword, tags.atom, tags.bool], color: "var(--link)" },
  { tag: [tags.monospace, tags.string], color: "var(--foreground)" },
])

const STATIC_SOURCE_EDITOR_EXTENSIONS: Extension[] = [
  basicSetup,
  markdown(),
  EditorState.tabSize.of(2),
  EditorView.lineWrapping,
  keymap.of([indentWithTab]),
  SOURCE_EDITOR_THEME,
  syntaxHighlighting(SOURCE_EDITOR_HIGHLIGHT_STYLE),
]

function createContentAttributes(documentName: string, spellCheck: boolean) {
  return EditorView.contentAttributes.of({
    "aria-label": `编辑 ${documentName} 源码`,
    autocapitalize: "sentences",
    spellcheck: String(spellCheck),
  })
}

function navigateToSourceLine(view: EditorView, requestedLine: number) {
  const line = Math.min(normalizeSourceEditorLine(requestedLine), view.state.doc.lines)
  const position = view.state.doc.line(line).from
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: "center" }),
  })
  view.focus()
}

export function SourceCodeEditor({
  active,
  content,
  documentName,
  documentPath,
  spellCheck,
  onContentChange,
  onFlushPendingEditsReady,
}: SourceCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const behaviorExtensionsRef = useRef<Extension[]>([])
  const attributesCompartmentRef = useRef<Compartment | null>(null)
  const initialContentRef = useRef(content)
  const initialDocumentNameRef = useRef(documentName)
  const initialSpellCheckRef = useRef(spellCheck)
  const documentNameRef = useRef(documentName)
  const spellCheckRef = useRef(spellCheck)
  const appliedContentRef = useRef(content)
  const mountedDocumentPathRef = useRef(documentPath)
  const onContentChangeRef = useRef(onContentChange)
  const onFlushPendingEditsReadyRef = useRef(onFlushPendingEditsReady)
  const activeRef = useRef(active)
  const applyingExternalChangeRef = useRef(false)
  const composingRef = useRef(false)
  const measureFrameRef = useRef<number | null>(null)
  const sessionsRef = useRef(new Map<string, SourceEditorSessionSnapshot>())

  if (!attributesCompartmentRef.current) attributesCompartmentRef.current = new Compartment()
  const attributesCompartment = attributesCompartmentRef.current

  onContentChangeRef.current = onContentChange
  onFlushPendingEditsReadyRef.current = onFlushPendingEditsReady
  activeRef.current = active
  documentNameRef.current = documentName
  spellCheckRef.current = spellCheck

  const emitCurrentContent = useCallback((view: EditorView, force = false) => {
    if (applyingExternalChangeRef.current) return
    if (!force && (composingRef.current || view.composing)) return
    const nextContent = view.state.doc.toString()
    if (nextContent === appliedContentRef.current) return
    appliedContentRef.current = nextContent
    onContentChangeRef.current(mountedDocumentPathRef.current, nextContent)
  }, [])

  const flushPendingEdits = useCallback(() => {
    const view = viewRef.current
    if (view) emitCurrentContent(view, true)
  }, [emitCurrentContent])

  useLayoutEffect(() => {
    const parent = containerRef.current
    if (!parent) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || applyingExternalChangeRef.current) return
      emitCurrentContent(update.view)
    })
    const compositionHandlers = EditorView.domEventHandlers({
      compositionstart: () => {
        composingRef.current = true
        return false
      },
      compositionend: (_event, view) => {
        composingRef.current = false
        queueMicrotask(() => emitCurrentContent(view))
        return false
      },
    })
    const behaviorExtensions = [...STATIC_SOURCE_EDITOR_EXTENSIONS, updateListener, compositionHandlers]
    behaviorExtensionsRef.current = behaviorExtensions
    const extensions = [
      ...behaviorExtensions,
      attributesCompartment.of(
        createContentAttributes(initialDocumentNameRef.current, initialSpellCheckRef.current),
      ),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: initialContentRef.current, extensions }),
      parent,
    })
    viewRef.current = view

    return () => {
      if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current)
      view.destroy()
      viewRef.current = null
    }
  }, [attributesCompartment, emitCurrentContent])

  useLayoutEffect(() => {
    if (!active) return
    onFlushPendingEditsReadyRef.current(flushPendingEdits)
    return () => {
      flushPendingEdits()
      onFlushPendingEditsReadyRef.current(null)
    }
  }, [active, flushPendingEdits])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return

    const previousDocumentPath = mountedDocumentPathRef.current
    if (previousDocumentPath !== documentPath) {
      sessionsRef.current.set(previousDocumentPath, {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      })
      const restoredSession = clampSourceEditorSession(sessionsRef.current.get(documentPath), content.length)

      applyingExternalChangeRef.current = true
      mountedDocumentPathRef.current = documentPath
      view.setState(
        EditorState.create({
          doc: content,
          selection: EditorSelection.range(restoredSession.anchor, restoredSession.head),
          extensions: [
            ...behaviorExtensionsRef.current,
            attributesCompartment.of(createContentAttributes(documentNameRef.current, spellCheckRef.current)),
          ],
        }),
      )
      applyingExternalChangeRef.current = false
      appliedContentRef.current = content

      if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current)
      measureFrameRef.current = requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = restoredSession.scrollTop
        view.requestMeasure()
        measureFrameRef.current = null
      })
      return
    }

    const currentContent = view.state.doc.toString()
    if (currentContent === content) {
      appliedContentRef.current = content
      return
    }

    const restoredSelection = clampSourceEditorSession(
      {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      },
      content.length,
    )
    applyingExternalChangeRef.current = true
    view.dispatch({
      changes: { from: 0, to: currentContent.length, insert: content },
      selection: EditorSelection.range(restoredSelection.anchor, restoredSelection.head),
      annotations: Transaction.addToHistory.of(false),
    })
    applyingExternalChangeRef.current = false
    appliedContentRef.current = content
  }, [attributesCompartment, content, documentPath])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: attributesCompartment.reconfigure(createContentAttributes(documentName, spellCheck)),
    })
  }, [attributesCompartment, documentName, spellCheck])

  useEffect(() => {
    if (!active) return
    const view = viewRef.current
    if (!view) return
    const pendingLine = consumePendingSourceEditorLine()
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current)
    measureFrameRef.current = requestAnimationFrame(() => {
      view.requestMeasure()
      if (pendingLine !== null) navigateToSourceLine(view, pendingLine)
      measureFrameRef.current = null
    })
  }, [active])

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      if (!activeRef.current) return
      const view = viewRef.current
      if (!view || !isSourceEditorNavigateEvent(event)) return
      navigateToSourceLine(view, consumePendingSourceEditorLine() ?? event.detail.line)
    }

    window.addEventListener(SOURCE_EDITOR_NAVIGATE_EVENT, handleNavigate)
    return () => window.removeEventListener(SOURCE_EDITOR_NAVIGATE_EVENT, handleNavigate)
  }, [])

  return (
    <div
      ref={containerRef}
      data-source-editor
      className={active ? "source-code-editor block h-full min-h-0" : "hidden"}
    />
  )
}
