/**
 * [INPUT]: 包含标准 action/sources、旧结果数组与 URL 来源的 AI SDK 消息 Part，以及 favicon URL 派生规则
 * [OUTPUT]: 跨供应商联网检索轨迹聚合、去重、限高滚动、安全呈现与网站图标回退的回归验证
 * [POS]: web-search-part 的数据适配与渲染单元测试
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { WebSearchPart, collectWebSearchTrace, faviconUrls } from "./web-search-part"

const parts = [
  {
    type: "tool-web_search",
    toolCallId: "search-1",
    state: "output-available",
    input: { query: "周士爵 说唱歌手" },
    output: [
      {
        type: "web_search_result",
        url: "https://example.com/profile",
        title: "人物资料",
        pageAge: "2 days ago",
        encryptedContent: "不得进入界面的供应商续轮数据",
      },
      {
        type: "web_search_result",
        url: "javascript:alert(1)",
        title: "不安全来源",
        pageAge: null,
        encryptedContent: "ignored",
      },
    ],
  },
  {
    type: "source-url",
    sourceId: "source-1",
    url: "https://example.com/profile",
    title: "重复来源",
  },
  {
    type: "source-url",
    sourceId: "source-2",
    url: "https://music.example.org/artist",
    title: "音乐人页面",
  },
] as UIMessage["parts"]

const responsesWebSearchParts = [
  {
    type: "tool-web_search",
    toolCallId: "search-2",
    state: "output-available",
    input: {},
    output: {
      action: {
        type: "search",
        queries: ["Celeste Madeline character", "Celeste Madeline story", "ws_call_id=call_00_internal"],
      },
      sources: [{ type: "url", url: "https://example.com/search-source" }],
    },
  },
  {
    type: "tool-web_search",
    toolCallId: "search-3",
    state: "output-available",
    input: {},
    output: {
      action: {
        type: "openPage",
        url: "https://celestegame.example/wiki/Madeline#ws_call_id=call_01_internal",
      },
    },
  },
] as UIMessage["parts"]

describe("联网搜索轨迹", () => {
  it("从工具与来源 Part 聚合真实查询并按 URL 去重", () => {
    const trace = collectWebSearchTrace(parts)

    expect(trace.queries).toEqual(["周士爵 说唱歌手"])
    expect(trace.searchCount).toBe(1)
    expect(trace.results).toHaveLength(2)
    expect(trace.results.map((result) => result.url)).toEqual([
      "https://example.com/profile",
      "https://music.example.org/artist",
    ])
  })

  it("读取 AI SDK Responses webSearch 的标准 output.action 与 output.sources", () => {
    const trace = collectWebSearchTrace(responsesWebSearchParts)

    expect(trace.searchCount).toBe(2)
    expect(trace.queries).toEqual(["Celeste Madeline character", "Celeste Madeline story"])
    expect(trace.results.map((result) => result.url)).toEqual([
      "https://example.com/search-source",
      "https://celestegame.example/wiki/Madeline",
    ])
  })

  it("在空 input 的 provider-executed 搜索中仍呈现真实查询与打开页面", () => {
    const markup = renderToStaticMarkup(<WebSearchPart parts={responsesWebSearchParts} streaming={false} />)

    expect(markup).toContain("已搜索 2 次 · 2 个来源")
    expect(markup).toContain("Celeste Madeline character")
    expect(markup).toContain("celestegame.example")
    expect(markup).not.toContain("ws_call_id")
  })

  it("呈现查询、来源计数和安全链接，不泄露加密续轮数据", () => {
    const markup = renderToStaticMarkup(<WebSearchPart parts={parts} streaming={false} />)

    expect(markup).toContain("已搜索 1 次 · 2 个来源")
    expect(markup).toContain("周士爵 说唱歌手")
    expect(markup).toContain('href="https://example.com/profile"')
    expect(markup).toContain('rel="noreferrer"')
    expect(markup).toContain('src="https://example.com/favicon.ico"')
    expect(markup).toContain('referrerPolicy="no-referrer"')
    expect(markup).toContain("max-h-64")
    expect(markup).toContain("overflow-y-auto")
    expect(markup).toContain('<section aria-label="联网搜索过程"')
    expect(markup).toContain('aria-label="联网搜索过程"')
    expect(markup).not.toContain("不得进入界面的供应商续轮数据")
    expect(markup).not.toContain("javascript:alert")
  })

  it("HTTPS 来源先请求站点图标，HTTP 来源只使用 HTTPS 回退服务", () => {
    expect(faviconUrls("https://www.example.com/path")).toEqual([
      "https://www.example.com/favicon.ico",
      "https://a.favicon.im/www.example.com?larger=true",
    ])
    expect(faviconUrls("http://example.com/path")).toEqual(["https://a.favicon.im/example.com?larger=true"])
    expect(faviconUrls("not-a-url")).toEqual([])
  })
})
