/**
 * [INPUT]: 连续增长、改写及包含组合字符的流式文本样例
 * [OUTPUT]: 尾部显示缓冲单调推进与异常改写快速收敛的回归验证
 * [POS]: ChatMarkdown 外层显示节奏控制器的纯函数测试
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { advanceTailStreamText } from "./tail-stream-text"

describe("流式文本尾部缓冲", () => {
  it("每次只从已显示前缀的尾部追加指定数量的字符", () => {
    expect(advanceTailStreamText("你", "你好，世界")).toBe("你好")
    expect(advanceTailStreamText("你", "你好，世界", 3)).toBe("你好，世")
  })

  it("不会拆开 emoji 或组合字符", () => {
    expect(advanceTailStreamText("", "👨‍👩‍👧‍👦你好")).toBe("👨‍👩‍👧‍👦")
    expect(advanceTailStreamText("", "e\u0301clair")).toBe("e\u0301")
  })

  it("源文本发生非尾部改写时直接收敛而不重播旧前缀", () => {
    expect(advanceTailStreamText("已经显示的旧内容", "修正后的内容")).toBe("修正后的内容")
    expect(advanceTailStreamText("完整内容", "完整")).toBe("完整")
  })
})
