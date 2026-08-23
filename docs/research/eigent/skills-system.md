# Eigent Skills 系统

> Eigent 证据：`backend/app/agent/toolkit/skill_toolkit.py`、
> `backend/app/service/skill_service.py`、`backend/app/service/skill_config_service.py`、
> `backend/app/controller/skill_controller.py`、`backend/app/utils/file_utils.py`、
> `backend/app/agent/prompt.py`、`backend/app/agent/factory/toolkit_assembler.py`、
> `backend/app/agent/factory/{browser,developer,document,multi_modal,social_media}.py`、
> `backend/app/service/chat_service.py`、`backend/tests/app/service/test_skill_initialization.py`、
> `resources/example-skills/`、`src/lib/skillToolkit.ts`、`src/store/skillsStore.ts`、
> `src/pages/Agents/Skills.tsx`、`src/pages/Agents/components/SkillUploadDialog.tsx`、
> `src/pages/Agents/components/SkillListItem.tsx`、
> `src/components/Session/SidePanelSections/buildContextItems.ts`
>
> Tessera 对照：`packages/skills/src/index.ts`、`packages/skills/builtins/`、
> `apps/desktop/src/main/user-skill-service.ts`、`apps/desktop/src/main/index.ts`、
> `apps/desktop/src/renderer/src/components/skill-management-page.tsx`、
> `apps/desktop/src/renderer/src/components/task-capability-picker.tsx`、
> `packages/contracts/src/index.ts`、`packages/database/user-skill-config-repository.ts`、
> `docs/architecture/skill-system.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的 Skill 是一个由 CAMEL `SkillToolkit` 承载的**运行时知识包**，不是独立 Agent，也不是权限容器。一个 Skill
目录至少有 `SKILL.md`，还可以携带 `references/`、`assets/`、`scripts/` 和许可证。模型启动时只得到
`list_skills` / `load_skill` 两个入口及“先枚举、再加载最匹配 Skill”的提示，正文在模型确认需要后才进入当前上下文。
这种渐进加载是它最值得 Tessera 学习的部分：Skill 库规模增长时，工具 schema 和摘要常驻，领域细节按需进入上下文；
右侧 Execution Context 又只展示本次真正 `load_skill` 的条目，而不是把所有启用项伪装成已使用。

但 Eigent 的“安装—配置—发现—运行”没有收敛成同一个受控对象。用户 Skill 内容放在共享的
`~/.eigent/skills`，启用和 Agent scope 却按用户写进另一棵目录；renderer 用 Zustand 再缓存一份；project config
还可以覆盖 user config。ZIP 导入由本地 Brain 接收整包字节并自行解压，后端没有文件数、解压后总量、单文件大小或
压缩比限制；Skill 可以携带并在正文中要求 Agent 执行 Python/Shell 脚本，而 Skill 本身没有声明式权限和统一审批。
这使“读取一篇方法文档”和“把第三方代码带入 Agent 工作区”在产品上看起来是同一个开关。

Tessera 当前用户 Skill 安装边界已经明显更安全：系统目录选择器、主进程短时扫描会话、严格 frontmatter、符号链接
拒绝、文件/体积预算、托管暂存后原子发布、SQLite 单一配置事实源、系统废纸篓删除，以及“附带脚本当前不自动执行”。
Tessera 目前反而缺少 Eigent 的两项运行体验：一是模型可在本次任务内通过目录摘要自行 `load_skill`，二是不同
Agent/Worker 的 Skill scope 与实际使用侧栏。建议保留 Tessera 安装和权限边界，在其上增加
`SkillCatalogSnapshot -> load-skill-resource -> RunSkillUsage`，而不是移植 Eigent 的共享目录、ZIP 服务或脚本执行方式。

## 1. 先分清六个阶段

把“支持 Skills”压成一个 boolean 会掩盖真正的生命周期。Eigent 实际至少有六个阶段：

| 阶段 | 回答的问题 | Eigent 对应 |
| --- | --- | --- |
| Distribution | 应用随包提供哪些模板？ | `resources/example-skills/` |
| Installation | 本机托管目录中有哪些 Skill？ | `~/.eigent/skills/<folder>/` |
| Discovery | 当前 Agent 能从哪些 root 发现？ | `SkillToolkit._skill_roots()` |
| Configuration | 是否启用，允许哪些 Agent？ | `skills-config.json` |
| Run exposure | 本次 Agent 拿到哪些摘要和加载入口？ | `allowed_skills` + `SkillToolkit.get_tools()` |
| Use | 本次实际加载/使用了哪个 Skill？ | `load_skill` runtime event + Execution Context |

这六层不应互相代替：安装不等于启用，启用不等于本次 Agent 可见，可见不等于模型加载，加载也不等于执行了 Skill
携带的脚本。Eigent 的 UI 已经能表达前四层的一部分和第六层，但持久化模型仍把多层状态分散在磁盘、用户配置、
project config、renderer store 和 runtime event 中。

Tessera 的目标对象可以更明确：

```text
SkillPackage          托管内容、来源、hash、版本、签名/许可证
SkillInstallation     用户安装、启停、更新状态
SkillDescriptor       名称、摘要、展示信息、能力需求
SkillRunBinding       本次 Run 可见的固定版本与适用 Agent
SkillResourceLoad     本次加载了正文或哪个 reference/asset
SkillAction           Skill 建议的操作，经平台工具和审批执行
```

其中最后一层绝不能由 Skill 文件自行变成操作权限。

## 2. 包格式：Skill 是目录，不只是提示词

### 2.1 最小入口

Eigent 只用根部 `SKILL.md` 判断一个目录是否为 Skill。frontmatter 至少包含：

```yaml
---
name: skill-security-auditor
description: "Security auditing for code, configs, and infrastructure..."
license: Complete terms in LICENSE.txt
---
```

Python `_parse_skill_frontmatter()` 和 renderer `parseSkillMd()` 都只提取 `name`、`description`，其他字段被忽略。
因此示例包里的 `license` 可以存在，但不会进入展示、许可判断或运行策略。解析器是正则/逐行的 YAML 子集：不做完整
YAML schema 校验，也没有重复字段、未知字段、名称规范、正文非空和最大字符数的后端统一约束。

同一份 Skill 在不同入口会得到不同校验结果：

- 扫描要求 name + description；
- `POST /skills/{skill_dir_name}` 可以写入任意 content，之后扫描可能静默忽略；
- 单个 `.md` 上传若没有 frontmatter，renderer 会尝试从首个标题/段落推断，再重建合法 `SKILL.md`；
- ZIP 内 `SKILL.md` 即使 frontmatter 不完整，也会用文件夹名作为冲突名并复制，之后可能不出现在列表。

这说明 Eigent 缺少一个所有安装、更新、扫描和运行共同调用的 `validateSkillPackage()`。

### 2.2 附属资源

固定提交的示例 Skill 已经证明目录是可执行资产包，而非纯 Markdown：

- `pdf` 带多个表单、图片转换和几何校验 Python 脚本；
- `docx`、`pptx`、`xlsx` 各约 1.2 MiB，包含 Office 解包/打包脚本、XML schema、模板和验证器；
- `skill-creator` 带初始化、打包、快速校验脚本及 references；
- `skill-security-auditor` 带 secrets/vulnerability references 和扫描脚本。

Skill 正文直接给出 `python scripts/scan_project.py ...`、`find`、`cat`、`npm audit` 等命令。CAMEL SkillToolkit 负责让
Agent 读到这些说明；真正执行仍通过 Agent 已有 Shell/File 工具。这种组合很灵活，但“Skill 安装”实际上会影响模型
未来可能发出的命令，不能只按文档导入看待。

### 2.3 Tessera 的兼容性取舍

Tessera `parseSkillDocument()` 当前只接受 `name` 和 `description`，未知字段会拒绝，因此 Eigent/生态里带 `license` 的包
不能直接导入。这是更严格、更可预测的边界，但长期会形成标准兼容问题。建议不是改成“忽略一切”，而是：

1. 定义版本化、允许字段清单；
2. 先加入无执行权的 `license`、`compatibility`、`metadata`；
3. 将 `permissions` 作为需求声明而非授权；
4. `scripts` / entrypoint 不放进 frontmatter 自动注册；
5. 未知字段在预览中明确报错或以 compatibility warning 展示。

## 3. 内置示例的发布与同步

### 3.1 双实现同步

Electron 主进程和 Python Brain 都实现了“把随包 example skills 同步到 `~/.eigent/skills`”。Python 路径
`sync_example_skills()` 会：

1. 从环境变量、打包 Resources、开发 repo/CWD 寻找 example root；
2. 忽略隐藏目录和没有 `SKILL.md` 的目录；
3. 新条目复制整棵树且不跟随 symlink；
4. 写 `.eigent-example-skill` marker；
5. 已托管 example 与 bundled 内容不同则整目录删除后重拷；
6. 本地目录若与 bundle 冲突但不被判断为 managed，则跳过并记录 warning。

“managed” 判断除了 marker，还允许 source/destination 的 frontmatter name 相同。这使旧版本升级能接管早期未写 marker 的
示例目录，但也可能把用户恰好用同名创建的目录判断成内置示例并覆盖。同步比较逐文件读取 bytes，没有 package manifest
或内容 hash；示例目录大时启动/扫描成本会增长。

Electron `electron/main/index.ts` 中又有相近的目录发现、比对、marker 和覆盖逻辑。两份实现共同维护一个根，带来和 MCP
双 writer 类似的漂移风险。当前 renderer 已经改为 Brain REST，不再需要第二套业务实现继续存在。

### 3.2 配置初始化

`skill_config_init()` 先读取 `default-config.json`，再扫描所有 bundled metadata，把未出现的示例设为：

```json
{
  "enabled": true,
  "scope": { "isGlobal": true, "selectedAgents": [] },
  "addedAt": 0,
  "isExample": true
}
```

固定提交的 `default-config.json` 自身 skills 为空，因此实际默认项来自 bundled scan。示例默认全 Agent 启用，意味着升级新增
一个内置 Skill 后，所有用户和未来 Agent 都可能立即看到它；如果新 Skill 含有危险命令工作流，这不是安全默认。

Tessera 的内置 Skill 采用代码注册表 + 动态 import，用户选择后才读取正文，不需要复制到可编辑 user root。这更适合“随
应用发布的可信内置内容”。未来若允许用户 fork 内置 Skill，应创建独立 user package，而不是原位修改后再与升级同步。

## 4. 扫描、创建与导入

### 4.1 扫描只看一个共享根

`GET /skills` 调用 `skills_scan()`：先同步 bundled examples，再遍历 `~/.eigent/skills` 的直接子目录，读取根部
`SKILL.md`，返回 display name、description、绝对 path、目录名和 `isExample`。它并不扫描文档所称的 repo/user/system
全部 roots；多 root discovery 只发生在运行时 CAMEL Toolkit 内。

因此管理 UI 看见的库与 Agent 可发现的库并不等价：

- repo 的 `skills/`、`.camel/skills`、`.agents/skills` 可能被 Agent 发现，但不出现在管理页；
- user 的 `~/.camel/skills` 也可能进入运行时，但 UI 不展示/配置；
- project config 可引用 UI 没有扫描到的名称；
- `path` API 把共享根中的绝对路径返回 renderer，仅服务 reveal-in-folder，却扩大了路径暴露面。

### 4.2 创建单文件 Skill

“Create Skill” 是一个 Markdown textarea。renderer 用轻量 parser 验证 name/description，然后调用 Brain 写
`~/.eigent/skills/<sanitized-name>/SKILL.md`，再写配置。服务端创建接口不做内容校验、不防已有目录覆盖，也没有临时文件、
fsync 或原子 rename。文件写成功、配置写失败时 UI 仍可保留内存项；反过来配置也可能残留已删除目录。

这类 best-effort 处理适合原型，不适合作为插件安装事务。

### 4.3 `.md` / `.skill` / ZIP 导入

renderer 接受 `.md`、`.skill`、`.zip`：

- `.skill` 通过前四个 magic bytes 判断是否 ZIP，否则当文本；
- 文件选择处限制 5 MiB；另有 50 MiB 的 renderer buffer guard，两套常量语义不一致；
- 文本导入最终只写一个 `SKILL.md`；
- ZIP 上传到 Brain，Brain `UploadFile.read()` 一次读入内存；
- ZIP 递归寻找所有 `SKILL.md`，所以一个 archive 可以安装多个 Skill；
- 同 display name 的现有 Skill 进入逐项 replace/skip 确认。

Brain 解压使用 `info.filename`，拒绝包含 `..` 的名称并去掉前导 `/`，可阻止常见 Zip Slip，但校验过粗且不完整：合法文件名
含 `..` 也被拒绝；没有检查解压后的 resolved path、不检查 symlink/external attributes，也没有文件数、单文件大小、总解压量、
压缩比、嵌套深度和磁盘余量。每个 member 使用 `zf.read(info)` 整体载入内存，压缩炸弹可以绕过前端压缩包大小。

导入的事务性也不完整：

- 先删除被替换目录，再复制新目录，失败无法恢复；
- 多 Skill archive 在中途失败时，前面已复制的不会回滚；
- incoming Skill 同名或最终 folder name 冲突没有完整批次去重；
- `dest_path.mkdir(..., exist_ok=True)` 后 copy 会与未识别目录合并；
- 不检查特殊文件、可执行位、许可证、脚本或敏感文件；
- `replacements` 信任客户端提交的 folder name，虽最终拼接固定 root，但缺少显式 root assertion。

### 4.4 Tessera 当前扫描/安装更成熟

Tessera 不接受 renderer 传入任意路径：IPC handler 自己打开系统目录选择器。批量扫描只把相对路径和一次性 candidate ID
送给页面，绝对路径留在主进程最多 15 分钟；深度 8、目录 4,096、候选 256。每个候选在真正安装时再次验证，而不是把扫描
当授权。

安装时限制 256 文件、单文件 4 MiB、总计 16 MiB；拒绝 symlink 和特殊文件；忽略 `.git`、`node_modules`、`.DS_Store`；
复制到随机 staging，复核 frontmatter 后同根 rename 发布；数据库失败会删除发布目录。删除先交系统废纸篓再删记录。这些边界
应保留，不能为了支持 Eigent ZIP 包退回 renderer buffer + Brain 解压。

如果 Tessera 要支持 ZIP，应在主进程新增**同等级别的 archive reader**：逐项流式预算、resolved path、symlink/hardlink/device
拒绝、批次冲突预览、全部 staging、逐包 hash、全成全败或明确逐项结果；不能复用普通文件上传 API。

## 5. 配置模型与 Agent scope

### 5.1 用户配置

每个用户使用：

```text
~/.eigent/user_<sanitized-id>/skills-config.json
```

旧版按 email `@` 前缀建立目录，加载时会 move 或 merge 到 canonical user dir。配置是 version 1 JSON，key 为 frontmatter
display name，value 包含 `enabled`、`scope`、`addedAt`、`isExample`。更新使用浅 merge，配置文件直接 `write_text()`，没有 lock、
原子 rename、并发版本或 schema validator。

Controller 直接相信 query/body 中的 `user_id`；在本地 Brain 缺少强鉴权的前提下，调用方可以读写其他逻辑 user key 的配置。
用户隔离只覆盖配置，不覆盖实际 Skill 内容：所有用户仍共享 `~/.eigent/skills`。这意味着一位本机用户安装/替换/删除包会影响
其他用户可读内容，而各自 enable 状态只控制是否暴露。

### 5.2 project override

运行时把用户配置与 `<working_directory>/.eigent/skills-config.json` 合并，project 同名项覆盖 user。这个设计提供 workspace
级 enable/scope，是值得借鉴的层级；但它没有版本、来源和 UI 解释，且 project file 可能来自不受信任仓库。一个项目可以把
用户已停用的 Skill 重新设为 enabled，也可以改变 Agent scope。

安全的 precedence 不应是简单 `config.update(project_config)`。建议：

- project 可以进一步收窄，不得扩大 user/organization policy；
- project 声明“建议启用”时需要用户接受；
- Run manifest 保存最终解析结果、来源层和 package hash；
- 未知 Skill ID 显示 unavailable，不静默忽略；
- project 文件本身按不受信任内容处理。

### 5.3 `isGlobal` 与 `selectedAgents`

UI 允许“所有 Agent”或具体 Agent。`isGlobal=true` 时空列表代表所有当前及未来 Agent；`isGlobal=false` 且空列表代表没有 Agent。
后端兼容旧 `agents` 数组，并规范 `single_agent` / `Agents.single_agent` 别名。相关测试覆盖 alias 和 selected scope。

这个功能对 Workforce 很重要：Document Skill 可以只给 Document Agent，浏览器 Skill 可以只给 Browser Agent，从而减少每个
Worker 的能力噪声。但当前绑定依赖可变字符串名字；内置 Agent、远程 sub-agent、自定义 worker 和 new-worker template 的命名
稍有漂移就会失效。应该绑定稳定 `AgentRoleId`/`WorkerTemplateId`，并在 Run 解析成具体 Agent instance。

### 5.4 配置过滤的边缘行为

`_build_allowed_skills()` 在 config 为空时返回 `None`，表示不应用过滤；一旦 config 非空，它只遍历 config keys，生成显式
allowed set。与此同时 `_is_skill_enabled()` 又写着“未配置默认启用”。两段组合的真实效果是：

- 完全没有配置：所有发现项可见；
- 已有任一配置：只有配置中且 enabled/scope 允许的名称进入 allowed set；
- 新落入 repo/user/system root、但尚未注册进 config 的 Skill 可能不可见。

renderer `syncFromDisk()` 会为共享 user root 新项补配置，所以主 UI 路径通常能弥补；repo、`.camel`、`.agents` roots 却不经过
该同步，最容易出现“文件存在但 Agent 看不见”。这是代码注释与组合语义不一致的典型问题，应通过一条 discovery + policy
resolver 和集成测试收敛。

## 6. 运行时发现与渐进加载

### 6.1 root precedence

Eigent 覆盖 CAMEL `_skill_roots()`，声明优先级：

```text
repo:
  <wd>/skills
  <wd>/.eigent/skills
  <wd>/.camel/skills
  <wd>/.agents/skills
user:
  ~/.eigent/skills
  ~/.camel/skills
  ~/.config/camel/skills
system:
  /etc/camel/skills
```

这套兼容目录很实用：既支持 Eigent 自有目录，也能读取 CAMEL/Agents 生态。但四个 repo root 彼此同名时的确定性、内容 hash、
遮蔽提示和 UI 展示全部交给依赖实现；Eigent 自身没有建立 resolved descriptor 快照。

### 6.2 装配到各 Agent

`SkillToolkit` 被加入 Single Agent，也出现在 Browser、Developer、Document、MultiModal、Social Media 和 Workforce 的
new-worker template。构造时传：

- `api_task_id`：日志/事件关联；
- `agent_name`：scope 判断；
- `working_directory`：repo discovery root；
- `user_id`：用户 config owner；
- 可选 timeout。

装配结果是同一组 SkillToolkit tools，并把 toolkit name 记入 Agent tool names。不同 Worker 各建一个 toolkit，各自在初始化时读取
配置和扫描 root；运行期间配置变化不会自动刷新已有 instance，这是隐式 Run snapshot，但没有保存解析结果供历史解释。

### 6.3 模型侧协议

系统提示在多个 Agent prompt 中重复同一约定：

1. 明确匹配领域任务时必须先调用 `list_skills`；
2. 确认精确名称后调用 `load_skill`；
3. 多个 Skill 匹配时优先最具体的；
4. 加载后按 Skill 指令执行。

renderer 的 Execution Context 源码也明确假设 SkillToolkit 只暴露 `list_skills` 和 `load_skill(name)`。因此 Eigent 的渐进加载
可抽象为：

```text
常驻：Skill 名称 + description + load tool schema
  -> 模型判断匹配
  -> load_skill(name)
  -> SKILL.md 正文进入 tool result / 当前上下文
  -> Agent 使用已有工具完成步骤
```

相比“本轮人工选择一个 Skill 后直接把全文放进 instructions”，它适合一轮内组合多个专业 Skill，也把长 references 的加载时机
留给正文中的进一步说明。但代价是多一次或多次模型 tool call，且模型可能漏调、误调，甚至把恶意 description 当路由指令。

### 6.4 项目同步函数并未接入

`sync_eigent_skills_to_project()` 会把 `~/.eigent/skills` 每个子目录删除后完整复制到
`<working_directory>/.eigent/skills`，注释称这样 Agent 可从项目工作目录执行它们。但固定提交全仓只有定义，没有调用方。
因此不能把“每个项目都有 Skill 副本”写成已实现能力。

如果未来接入，这个函数本身也有风险：

- direct-write workspace 会被应用写入 `.eigent/skills`；
- 每次同步覆盖项目同名内容；
- 用户包里的脚本、资产甚至误放的秘密被复制进项目；
- 没有 hash/版本/lock/清理已删除源项；
- project overlay 与 user root 的 precedence 更难解释。

正确做法不是复制 Skill 到用户项目，而是把 package 作为 Run 的只读挂载/资源引用；只有 Agent 生成的输出进入 workspace change set。

## 7. 实际使用如何进入右侧 Execution Context

Eigent 的 `buildContextItems()` 不会因 Skill “已启用”就显示它。它遍历 Agent task 和 `taskRunning` 的 runtime toolkit event：

- `list_skills` 只是枚举，不产生 Skill 行；
- `load_skill` 从 tool args 中解析单个或多个 Skill 名称；
- 兼容 JSON args、Python repr、下划线/空格 method name；
- args 与 tool result 被拼到同一 message 时只解析首行；
- 用 `skill:<name>` 去重，再以 Wand 图标显示。

这个产品原则非常好：库、Run exposure 和实际 use 分层。代码却很脆弱，因为 SkillToolkit 没有统一的结构化 usage event，renderer
只能猜两种字符串编码和截断格式。如果 backend 修改日志拼接方式，侧栏会静默漏项。

Tessera 应由运行时发稳定事件：

```ts
type SkillResourceLoaded = {
  runId: string
  agentId: string
  skillId: string
  packageHash: string
  resource: "SKILL.md" | `references/${string}` | `assets/${string}`
  loadedAt: number
}
```

侧栏从持久化事件投影，不解析 prompt/tool message。若 Skill 只是人工选中却尚未读取，可显示为“本次可用”；真正读取后再进入“执行
上下文”。

## 8. 安全模型：Skill 内容与 Skill 权限必须分离

### 8.1 Eigent 当前隐式授权

Eigent Skill 没有声明式权限字段。Agent 能否执行 Skill 建议，取决于该 Worker 本来装配了哪些工具：Browser Agent 有浏览器，Developer
Agent 有 terminal/file，Document Agent 有文档工具。Agent scope 只能决定“能否 load 这篇指南”，不能限制指南加载后具体使用哪些工具。

这会产生 confused deputy：一个第三方 Skill 描述“为完成任务必须读取 `~/.ssh`、运行 curl、上传结果”，如果它被分配给具有 broad
filesystem/shell/network 的 Agent，Skill 的自然语言就能诱导已有权限。没有统一 per-tool approval 时，用户只看见“启用 Skill”开关，
无法理解真实操作面。

### 8.2 包内容供应链

示例包带 LICENSE，但扫描和 UI 不展示；用户 ZIP 没有来源、发布者、版本、hash、签名、许可证或更新通道。`isExample` 通过目录与 bundle
name/marker 推断，不是不可伪造 package identity。替换确认只按 display name，不呈现文件 diff 或新增脚本。

Skill 市场若没有供应链层，会比 MCP 市场更危险：MCP 至少在独立 server/process 边界，Skill 则能以自然语言引导 Agent 使用所有现有
工具。Tessera 在做社区目录前至少需要 package digest、来源 URL/issuer、版本、文件清单、license、更新 diff、风险声明和撤销状态。

### 8.3 Tessera 已有正确边界

Tessera 当前用户 Skill descriptor 的 `permissions` 为空，运行时也不会执行附属脚本。内置 Skill 的 permissions 只是需求描述，真正工具
来自本轮 `TaskRunPolicy`、显式工作区资源和审批；文件写入仍走预览/批准/版本复核/原子应用。这是正确方向。

下一步不应把脚本目录直接变成 executable。更稳妥的资源类型是：

| 资源 | 默认行为 | 放开条件 |
| --- | --- | --- |
| `SKILL.md` | 作为不受信任指令按需加载 | 已安装、启用、Run 绑定 |
| `references/*.md` | 模型请求后读取，计入上下文预算 | 路径在 package manifest |
| `assets/*` | 预览/作为附件，不解释为指令 | media type、大小校验 |
| `scripts/*` | 仅展示，不执行 | 独立 sandbox action + 明确审批 |
| 网络/MCP 建议 | 不自动连接 | Run capability 已授权 |

## 9. UI 与交互评价

### 9.1 做得好的部分

- “Your Skills / Example Skills”分开，用户能理解来源；
- 每张卡显示名称、说明、启停、试用和 Agent access；
- `isGlobal` 表示包括未来 Agent，语义比逐个全选稳定；
- ZIP 冲突逐项确认，可部分替换、部分跳过；
- “Try in chat”创建新 Project，并用 `{{skill-name}}` 显式提示用户已选能力；
- 实际 `load_skill` 后才出现在 Execution Context。

### 9.2 仍不够的部分

- 卡片不显示版本、来源、文件数、体积、许可证、脚本数量和风险；
- 没有内容预览、文件树和 update diff；
- enable 开关容易被理解为权限批准；
- Agent scope 绑定字符串角色，没有解释当前/未来 Worker；
- UI 管理库与 runtime 多 root discovery 不一致；
- Zustand persist 让磁盘/配置失败后仍可能短暂展示幽灵项；
- 删除 example 被禁止，却未解释升级会覆盖其内容；
- 文本导入接受非标准 Markdown再自动修复，运行侧标准却更严格；
- 两个大小常量 5 MiB/50 MiB 相互矛盾；
- `handleConflictConfirm` 固定提交中连续调用两次 `syncFromDisk()`，体现状态刷新链路缺乏单一事务结果。

Tessera 当前管理页更强调权限边界、托管方式和扫描预览；后续可以吸收 Eigent 卡片上的 Agent scope 与“带此 Skill 新建任务”，但应把
“启用”“本轮选择”“实际加载”用不同视觉状态表达。

## 10. Tessera 逐项对照

| 能力 | Eigent | Tessera 当前状态 | 结论 |
| --- | --- | --- | --- |
| 标准入口 | SKILL.md，宽松 name/description parse | 严格 name/description parser | Tessera 更安全，需补兼容字段策略 |
| 内置发布 | 复制 bundle 到共享 user root | 动态 import 内置注册表 | 保持 Tessera |
| 用户安装 | 文本写入或 ZIP 解压到共享 root | 系统选择器、受限完整目录托管 | Tessera 更成熟 |
| 批量扫描 | ZIP 内递归找 SKILL.md | 主进程受限扫描、短时会话、勾选安装 | Tessera 更成熟 |
| ZIP | 支持多包，后端预算不足 | 未实现 | 若实现必须保持主进程安全预算 |
| Symlink/特殊文件 | examples copy 忽略；ZIP 未统一拒绝 | 导入统一拒绝 | 保持 Tessera |
| 原子发布 | 创建/替换非原子 | staging + rename + DB 回滚 | Tessera 更成熟 |
| 删除恢复 | rmtree | 系统废纸篓后删记录 | Tessera 更成熟 |
| 配置事实源 | JSON + project file + Zustand | SQLite + 托管目录复核 | Tessera 更清晰 |
| 用户隔离 | 配置隔离，内容共享 | 单机应用托管，当前无多账号层 | Eigent 不构成真正内容隔离 |
| workspace scope | runtime 多 roots/project override | 类型与文档已有，自动发现未实现 | 可借鉴，但只能收窄权限 |
| Agent scope | all/specific Agents | 未实现 | 应绑定稳定角色/Run Agent |
| 渐进加载 | list/load tools，模型可组合多 Skill | 人工/自动选中一个主 Skill后注入正文 | 可增加资源式 load，但保留主 Skill 策略 |
| references/assets | CAMEL root 可读取，示例已携带 | 托管但运行时未加载 | 下一阶段可按需开放 |
| scripts | 正文引导 Agent 用现有 shell 执行 | 当前不执行 | 保持隔离，未来独立 sandbox approval |
| 权限声明 | 无，依赖 Agent 工具集合 | descriptor 需求 + RunPolicy/审批 | Tessera 更正确 |
| Run snapshot | toolkit 初始化隐式冻结，无记录 | task_run 固化 skillId/policy | Tessera 更可追溯，需补 package hash |
| 实际使用侧栏 | 解析 load_skill runtime message | 尚无统一 Skill usage 侧栏 | 吸收产品原则，使用结构化事件 |
| 版本/更新/签名 | 未实现 | 未实现 | 社区分发前置能力 |

## 11. 推荐的 Tessera 目标架构

### 11.1 保留“一个主 Skill”，增加资源式补充 Skill

Tessera 的 research/writing 是整轮方法论和工具策略，应继续作为 `primarySkillId`；不要让模型在运行中加载另一个 Skill 后悄悄改变
RunPolicy。Eigent 的 list/load 更适合作为**补充知识资源**：

```text
RunPolicy.primarySkill
  research | writing | user:foo | null

RunSkillCatalogSnapshot
  本轮允许发现的 supplementary skills，仅含 id/name/description/hash

load-skill-resource(skillId, resource?)
  返回受预算限制的正文/reference，记录 usage event，不新增工具和权限
```

主 Skill 决定任务方法和可解释路由；补充 Skill 提供格式、领域步骤、模板和参考，不得改变已冻结 capability manifest。

### 11.2 Skill package manifest

安装后由主进程生成而不是信任包内自述：

```ts
type InstalledSkillPackage = {
  id: `user:${string}`
  name: string
  description: string
  source: { kind: "directory" | "archive" | "registry"; label: string }
  digest: string
  installedAt: number
  version?: string
  license?: string
  files: Array<{ path: string; bytes: number; sha256: string; kind: "instruction" | "reference" | "asset" | "script" }>
  risk: { hasScripts: boolean; requestedCapabilities: string[] }
}
```

SQLite 保存 metadata/control state，托管目录保存内容事实；每次 Run 只保存 package ID、digest 和加载资源，不复制全文。

### 11.3 scope resolution

作用域建议按以下顺序解析，且后层只能收窄：

```text
organization policy
  ∩ user enabled/trust
  ∩ workspace accepted policy
  ∩ Run explicit/auto binding
  ∩ Agent role eligibility
  ∩ current capability availability
```

最终结果写入 `RunSkillCatalogSnapshot`。设置中途更新不改变正在运行的 catalog；真正读取或执行时仍核对 package 是否被撤销/损坏，
并以结构化 unavailable 结束而不是换用同名新内容。

### 11.4 按需资源工具

`load-skill-resource` 应由应用内置，输入只接受 snapshot 中 Skill ID 和 manifest 内相对路径：

- 禁止 `..`、绝对路径、symlink；
- 只读托管根，不读原始导入路径；
- `SKILL.md`、reference 分别设字符/Token 上限；
- asset 以 attachment/artifact 引用返回，不 base64 塞进文本；
- script 只返回摘要/预览，不返回“已执行”；
- 每次 load 计入统一 ContextBudget；
- tool result 标记不受信任内容边界，不能覆盖 platform instruction；
- 使用事件持久化并投影到右侧栏。

### 11.5 Agent/Workforce 绑定

未来子 Agent 不需要复制 Eigent 的 mutable `selectedAgents: string[]`。更稳妥的是 Skill descriptor 声明 eligibility，例如
`roles: [document, developer]`，Run planner 决定给哪个 child run；用户可在设置页设默认 allow/deny，但实际绑定由 Run manifest 保存
`skillId + agentRole + agentInstanceId`。

如果主 Agent 委派 Document child run，child 只继承：

- 明确分配的 Skill resources；
- 当前 task resource subset；
- 需要的最小工具集合；
- 独立预算和审批上下文。

这比所有 Worker 各自扫描整棵 user/system roots 更容易审计。

## 12. 推荐实施顺序

### P0：把当前实现补成可审计 Run 闭环

- 为用户 Skill 托管目录生成 package digest 和文件 manifest；
- `task_run` 固化 skill digest，而不只保存 `user:<name>`；
- 运行历史区分“选择/可用/实际加载”；
- 右侧执行上下文从结构化事件展示主 Skill 和已加载资源；
- 托管文件损坏/删除时报告精确 unavailable，不自动用同名新版本替代；
- 增加导入/扫描/运行的端到端测试，避免 IPC handler 缺失类回归。

### P1：补充 Skill 渐进加载

- 增加当前 Run 的元数据 catalog snapshot；
- 内置 `list-available-skills` / `load-skill-resource`，不允许注册新工具；
- 支持 `references/*.md` 的按需读取与 ContextBudget；
- UI 显示模型加载了哪个 resource、何时加载、由哪个 Agent 加载；
- primary Skill 与 supplementary Skill 分离，评测漏调/误调/上下文成本。

### P2：workspace scope 与版本更新

- 只读发现 workspace Skill，默认提出安装/信任，不直接执行；
- workspace policy 只能收窄 user trust；
- 更新显示 package/file diff、许可证和脚本变化；
- 支持保留旧 digest 供活跃/历史 Run 复核；
- Agent role scope 使用稳定 ID。

### P3：社区目录与受控脚本

- registry publisher、签名、digest、版本、撤销/安全公告；
- 安装前权限/脚本/依赖/许可证审查；
- scripts 进入隔离 sandbox，以独立工具动作、参数 schema、网络/文件权限和逐次审批执行；
- 先有供应链和 sandbox，再开放一键社区安装，顺序不能反过来。

## 13. 不应照搬的部分

1. 不让 Electron 与 Brain 同步同一套 example Skills。
2. 不把多用户配置分开，却共享一个可被任意用户替换的内容根。
3. 不让 project config 静默扩大用户已关闭的 Skill。
4. 不把 renderer Zustand cache 当安装成功事实。
5. 不用无预算 ZIP 解压作为普通导入入口。
6. 不在替换时先 `rmtree` 旧包，再尝试复制新包。
7. 不把 Skill 正文里的 shell/python 命令视为已经授权。
8. 不把 Agent 名称字符串当长期 scope identity。
9. 不把全部 user Skills 复制进每个 workspace。
10. 不从拼接后的 tool log 字符串反解析 Skill 使用事实。
11. 不默认全 Agent 启用应用升级新带来的 Skill。
12. 不先做社区数量，再补 hash、版本、许可证、diff、撤销和 sandbox。

## 14. 最终判断

Eigent 把 Skill 做成“可携带文档、references、assets 和 scripts 的目录包”，并通过 `list_skills/load_skill` 让模型渐进式选择，这是
比静态 prompt preset 更接近 Agent 能力生态的设计。Agent scope、示例库、创建/导入、Try in chat 和实际使用侧栏又把这套机制做成了
普通用户能理解的产品，而不只是开发者配置文件。

它同时暴露了 Skill 系统最容易走的弯路：把自然语言工作流误当成低风险内容，把 enable 误当成授权，把目录可读误当成脚本可执行，把
多 root discovery 误当成可解释的优先级，把配置 JSON 和 UI cache 误当成安装事务。Tessera 已经有更好的托管与权限地基，不应为了追平
格式数量而削弱边界。

Tessera 最值得吸收的组合是：**严格托管包 + 运行时 catalog snapshot + 正文/reference 渐进加载 + 稳定 Agent role 绑定 + 实际加载
侧栏 + 所有操作继续走平台工具审批**。这样既能获得 Eigent 的可扩展体验，也不会让 Skill 成为绕过 workspace、MCP、Shell 和审计边界的
后门。
