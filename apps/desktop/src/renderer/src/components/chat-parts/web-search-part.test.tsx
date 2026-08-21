/**
 * [INPUT]: 包含真实查询、重复工具结果与 URL 来源的 AI SDK 消息 Part，以及 favicon URL 派生规则
 * [OUTPUT]: 联网搜索轨迹聚合、去重、安全呈现与网站图标回退的回归验证
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

  it("呈现查询、来源计数和安全链接，不泄露加密续轮数据", () => {
    const markup = renderToStaticMarkup(<WebSearchPart parts={parts} streaming={false} />)

    expect(markup).toContain("已搜索 1 次 · 2 个来源")
    expect(markup).toContain("周士爵 说唱歌手")
    expect(markup).toContain('href="https://example.com/profile"')
    expect(markup).toContain('rel="noreferrer"')
    expect(markup).toContain('src="https://example.com/favicon.ico"')
    expect(markup).toContain('referrerPolicy="no-referrer"')
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
