# 调度、Trigger 与远程控制

> 研究对象：Eigent `d3089558c6e0021eed58270b49893835b02ec4e9`
>
> 结论类型：源码事实、研究推断与 Tessera 建议分开标记
>
> Tessera 状态：未实现业务调度、Webhook/Slack Trigger 与远程控制；现有 `Run`、权限、审计和工作区边界可作为基础

## 1. 结论先行

Eigent 已经做出一套产品上完整的自动化入口：用户可以把 Schedule、通用 Webhook 或 Slack Event 绑定到 Space、
Project 和任务 Prompt，服务端保存 Trigger 与 Execution，Celery Beat 发现到期任务，Redis Pub/Sub 把执行通知到桌面，
桌面再把任务放进项目后台队列并启动真实 Agent。它还提供执行历史、频率限制、单次执行、失败自动停用、重试、
连接健康提示和可视化时间选择器。

但这套 Trigger 不是“服务端 Agent 调度器”，而是一条 **服务端生成意图、在线桌面负责执行** 的通知链。其关键语义是：

```text
Celery / Webhook
    │
    ├── 写 TriggerExecution(pending)
    ├── Redis Pub/Sub 广播 execution_created
    │
    └── 在线桌面 WebSocket 收到后 ACK、入本地队列、启动 Agent
```

这种设计很适合快速把已有桌面 Agent 接上 Schedule/Webhook，却没有形成可靠 Job Queue：

- Redis Pub/Sub 不保留离线消息，桌面稍后上线不会自动补领旧执行；
- 同一用户的所有在线窗口都会收到相同事件，都会立即 ACK 并各自入队，存在重复执行；
- ACK 只表示 renderer 收到消息，不表示任务成功进入唯一消费者的持久队列；
- Schedule 在执行前就前移 `next_run_at`，单次任务也会先停用，投递失败不会补偿日程状态；
- pending/running 超时只改服务端状态，不会取消已经在桌面运行的 Agent；
- Webhook 没有业务幂等键，Slack `event_id` 被保存但未用于去重；
- 执行位置依赖桌面在线，却没有把 `execution_target`、设备租约和能力快照建模为一等对象。

Eigent 自己的 Remote Control 模块反而已经解决了 Trigger 中不少问题：它为命令持久化 `pending → delivered →
acknowledged/failed/expired` 状态，按稳定 `desktop_instance_id` 定向投递，桌面按 `command_id` 去重并缓存 ACK，重连
会补发 pending 命令，后台会重投和超时，切换失败还带条件补偿。这两套协议并存，是本专题最重要的源码发现。

**Tessera 不应先复制 Trigger UI，再补可靠性。** 应先统一建立：

```text
AutomationDefinition
    → Invocation（外部事件或到期事实）
    → RunRequest（冻结能力与输入）
    → ExecutionLease（唯一执行者）
    → Run（真实 Agent 生命周期）
```

Schedule、Webhook、Slack、未来文件监听与远程控制都只是 `InvocationSource`。它们共享幂等、租约、重试、权限、审计
和 Run 投影，而不是各自再造一套“收到消息就开始跑”的链路。

## 2. 研究范围与证据

### 2.1 服务端 Trigger

- 数据模型：`Eigent: server/app/model/trigger/trigger.py`、`trigger_execution.py`
- 枚举与状态：`Eigent: server/app/shared/types/trigger_types.py`
- 类型配置：`Eigent: server/app/model/trigger/app_configs/*.py`
- CRUD 与激活：`Eigent: server/app/domains/trigger/service/trigger_crud_service.py`
- Schedule 轮询：`Eigent: server/app/domains/trigger/service/trigger_schedule_service.py`
- Celery 任务：`Eigent: server/app/domains/trigger/service/trigger_schedule_task.py`
- Celery Beat：`Eigent: server/app/core/celery.py`
- Webhook 入口：`Eigent: server/app/domains/trigger/api/webhook_controller.py`
- Slack/通用 Handler：`Eigent: server/app/domains/trigger/service/app_handler_service.py`
- 执行 REST/WebSocket：`Eigent: server/app/domains/trigger/api/trigger_execution_controller.py`
- Redis Session/PubSub：`Eigent: server/app/core/redis_utils.py`
- 速率限制：`Eigent: server/app/core/trigger_utils.py`

### 2.2 桌面执行

- WebSocket 订阅：`Eigent: src/hooks/useExecutionSubscription.ts`
- Trigger 事件到项目队列：`Eigent: src/hooks/useTriggerTaskExecutor.ts`
- 后台任务处理器：`Eigent: src/hooks/useBackgroundTaskProcessor.ts`
- 消息格式与执行映射：`Eigent: src/store/triggerTaskStore.ts`
- Agent 完成回报：`Eigent: src/store/chatStore.ts::updateTriggerExecutionStatus`
- REST 客户端：`Eigent: src/service/triggerApi.ts`
- Trigger 编辑器：`Eigent: src/components/Trigger/TriggerDialog.tsx`
- 时间选择器：`Eigent: src/components/Trigger/SchedulePicker.tsx`

### 2.3 远程控制对照组

- 数据模型：`Eigent: server/app/model/remote_control/remote_control.py`
- 会话与命令服务：`Eigent: server/app/domains/remote_control/service/remote_control_service.py`
- WebSocket Bridge：`Eigent: server/app/domains/remote_control/api/remote_control_controller.py`
- 桌面 Bridge：`Eigent: src/hooks/useRemoteControlBridge.ts`
- Web 远控页：`Eigent: src/pages/RemoteControl.tsx`
- 桌面分发页：`Eigent: src/components/Dispatch/index.tsx`

## 3. 产品对象与状态模型

### 3.1 Trigger 不是 Run

`Trigger` 是长期自动化定义，核心字段可分成六组：

| 分组 | 字段 | 语义 |
| --- | --- | --- |
| 归属 | `user_id`、`space_id`、`project_id` | 自动化运行在哪个用户、Space、Project 下 |
| 定义 | `name`、`description`、`trigger_type`、`task_prompt` | 事件来源和要交给 Agent 的目标 |
| 路由 | `listener_type`、`agent_model` | 声明运行形态与模型，但实际桌面链未完整消费 |
| Schedule | `custom_cron_expression`、`next_run_at` | UTC Cron 与下一次发现时间 |
| Webhook | `webhook_url`、`webhook_method`、`config` | 公共 URL、方法、过滤与集成配置 |
| 治理 | 次数限制、`is_single_execution`、失败数、停用时间 | 速率、生命周期和自动停用 |

`TriggerExecution` 是一次触发尝试，包含：

- 全局唯一 `execution_id`；
- 来源 `scheduled/webhook/manual/slack`；
- `pending/running/completed/failed/cancelled/missed`；
- 输入、输出、错误、结构化跳过原因；
- 开始/完成/耗时；
- `attempts/max_retries`；
- Token 与工具执行统计。

这个拆分方向正确：定义不等于执行，执行需要独立历史。但 `TriggerExecution` 仍然把三个不同阶段揉在一起：

1. 外部事件已被接收；
2. 任务已投递到某个客户端；
3. Agent Run 正在执行。

因此 `pending` 的含义会漂移，`started_at` 也在创建执行时、桌面 ACK 时和桌面真正开跑时被不同路径重复设置。

### 3.2 Trigger 状态

Trigger 有：

```text
pending_verification → active ↔ inactive
                           ├── completed
                           └── stale（本次未发现主链赋值）
```

- Slack 等需要鉴权的 Trigger 先进入 `pending_verification`；
- 收到通过签名校验的真实事件后变为 `active`；
- Schedule 到期后可变为 `completed`；
- 连续失败达到 `max_failure_count` 会自动变 `inactive`；
- 单次 Schedule 在生成 Execution 时立即变 `inactive`，而不是在成功完成后变 `completed`。

`stale` 虽在枚举中存在，但本次固定源码没有找到清晰进入路径。它是典型的“枚举先于行为”状态，不能视为已实现。

### 3.3 Execution 状态并非严格状态机

理想状态应该限制合法跃迁；Eigent 的 REST 更新最终可把已有执行写成调用方提交的状态。主要路径虽然会检查
`pending` 才接受 WebSocket ACK，但完成 API 未对“超时后迟到的 completed”建立 compare-and-set 约束。

实际可能出现：

```text
pending ──60s──> missed ──桌面迟到完成──> completed
running ──600s─> failed ──桌面迟到完成──> completed
```

是否允许迟到成功不是纯技术问题，应成为明确策略：

- `strict timeout`：超时后 Run 必须停止，迟到结果只留审计；
- `soft timeout`：显示超时但接受迟到结果，状态应是 `completed_late`；
- `reconciled`：控制面查询真实 Run 后再决定最终状态。

Eigent 当前没有把这三种语义区分开。

## 4. Schedule：从本地时间到到期发现

### 4.1 UI 生成 UTC Cron

`SchedulePicker` 提供单次、每日、每周、每月四种模式，并预览未来五次时间。用户输入按本地时区展示，组件使用
`localTimeToUTC` 转换为五段 Cron；编辑时再用 `utcTimeToLocal` 还原。

Cron 无法表达年份，所以配置 JSON 另存：

- `date`：单次任务完整 UTC 日期；
- `expirationDate`：周期任务最后允许日期；
- `max_failure_count`：连续失败自动停用阈值。

跨午夜时，组件会根据 `dayOffset` 调整日期、星期或月日。这比简单把本地小时减时差更完整，尤其考虑了 UTC 日期
偏移。

但它仍然把“用户意图时区”编译成静态 UTC Cron，未保存 IANA timezone。结果是夏令时切换后，任务会保持固定 UTC
时刻，而不是保持用户原本选择的本地时刻。例如用户选择纽约每天 09:00，DST 切换后可能变成当地 08:00 或
10:00。

**Tessera 建议：** Schedule 定义保存：

```text
schedule_kind: once | cron | interval | calendar
expression: ...
timezone: Asia/Shanghai | America/New_York
dst_policy: wall_clock | fixed_utc
misfire_policy: skip | fire_once | catch_up
start_at / end_at
```

UI 预览和服务端求值必须共用同一调度库与同一时区事实，不能各写一套 Cron 解释器。

### 4.2 创建时计算 `next_run_at`

Trigger CRUD 在创建或更新活跃 Schedule 时使用 Python `croniter` 计算 `next_run_at`。Celery Beat 默认每分钟触发
`poll_trigger_schedules`，服务查询：

```text
trigger_type = schedule
status = active
next_run_at <= now(UTC)
order by next_run_at
limit 100
```

轮询间隔由环境变量配置，默认一分钟；最大每 tick 分发数默认 `0`，表示不限制。

### 4.3 没有并发领取锁

查询没有 `SELECT ... FOR UPDATE SKIP LOCKED`、原子 `UPDATE ... WHERE next_run_at = expected` 或分布式租约。若多个
Beat/Worker 实例并发执行同一轮询任务，它们可能读到相同 Trigger，各自创建 Execution。

虽然默认部署可能只有一个 Beat，这不是数据层保证。调度器应把“某个 occurrence 被谁领取”做成数据库唯一事实，例如：

```text
unique(automation_id, scheduled_for)
```

即使多个 scheduler 同时发现到期，也只有一个能插入该 occurrence。

### 4.4 分发前已经推进日程

到期分发顺序是：

1. 校验日期是否过期；
2. 创建 `TriggerExecution(pending)`；
3. 更新 `last_executed_at/status`；
4. 计算并写入下一次 `next_run_at`；
5. 单次任务立即停用；
6. 提交数据库；
7. best-effort Redis 发布。

这能避免 Pub/Sub 失败时数据库事务长时间占用，却意味着“日程推进成功、执行未投递”是正常可达状态。发布失败
只记 warning，Execution 留在 pending，之后由超时任务标成 missed；没有补投。

对用户而言，“Schedule 到点”与“Agent 开始执行”是两个事实。Tessera 应分别记录：

- `scheduled_for`：本应运行的时间；
- `invoked_at`：调度器创建 Invocation 的时间；
- `leased_at`：执行者获得租约的时间；
- `run_started_at`：Agent 实际开始时间；
- `completed_at`：Run 完成时间。

### 4.5 Rate Limit 跳过没有审计行

Schedule 到期但超过小时/天限制时，代码只计算下一次 `next_run_at`，不创建带 `skip_reason=rate_limited` 的
Execution。用户历史里看不到这次 occurrence 被跳过。

次数限制本身通过查询一小时/一天内的全部 Execution 后在 Python 计算长度，数据量大时成本上升；并发 Webhook 也
可能同时通过检查。更稳妥的方案是原子计数桶或在 Invocation 唯一约束后统一决策，同时为每次跳过留审计记录。

### 4.6 Misfire 没有被建模

如果服务停机半天，恢复时 `next_run_at` 仍在过去。当前逻辑每处理一次便从“现在”计算下一次，而非从旧
`scheduled_for` 连续补齐，因此近似 `fire_once`；但这只是实现结果，没有显式 `misfire_policy`。

同样，计算 Cron 失败会把 `next_run_at` 推到一年后，避免紧密重试，却将配置错误伪装成“未来仍有效”。更合理的是
把 Trigger 标成 `invalid_configuration` 并向用户暴露诊断。

## 5. Webhook：公共事件如何进入 Agent

### 5.1 公共入口与查找

创建通用 Webhook 或 Slack Trigger 时，服务端生成随机 UUID 路径。公共入口支持 GET/POST，并有 IP/请求级限流
`10/60s`。根据 URL 查找 `active` 或 `pending_verification` Trigger。

通用 Webhook 可限制 HTTP 方法；过滤器还支持：

- Body 包含文本；
- Header 必需键值；
- Header 正则；
- 公共 `message_filter` 正则；
- 是否把 headers、query、请求 metadata 放入 Agent 输入。

Authorization 与 Cookie Header 会在进入标准化 payload 前过滤，这一点是正确的最小化策略。但其他 Header、
body、client IP 和 URL 仍可能包含敏感数据，应有大小限制、字段 allowlist、保留期和日志脱敏策略。

### 5.2 “鉴权开关”与真实认证

通用 Webhook 的 Base Config 有 `authentication_required`，但固定源码中的 `DefaultWebhookHandler` 没有实现签名、
Basic Auth 或共享 Secret 验证；它继承 Base Handler 的默认成功。因此这个开关不能等同于通用 Webhook 已具备认证。

Slack 则走专用 Handler，从 Config 表读取 Bot Token/Signing Secret，通过 CAMEL `SlackAuth` 完成 URL challenge 和
签名验证。凭据字段通过 schema 的 `exclude` 标记不写进 Trigger JSON，而是进入用户 Config Group。这种“Trigger
只引用集成连接、Secret 单独保存”的方向值得学习，不过 Eigent 的 Config 表自身是否达到系统凭据库安全强度，需
结合 MCP/Provider 专题中的 Secret 结论看待。

### 5.3 App Handler 是可扩展点

`get_app_handler(trigger_type)` 把不同事件源的认证、过滤、标准化拆成三步：

```text
authenticate(request, raw_body)
    → filter_event(payload, trigger)
    → normalize_payload(payload, request_meta)
```

这是清晰的 Connector Trigger SPI：新增 GitHub、Linear、Notion 等事件源时，可以复用公共入口和 Execution 记录。
Tessera 可以吸收这个三段式，但应进一步加入：

- `verify_replay_window`；
- `derive_idempotency_key`；
- `classify_sensitivity`；
- `redact_for_log`；
- `resolve_connection_ref`；
- `build_context_resources`。

### 5.4 没有幂等与重放保护

通用 Webhook 每次请求都生成新 UUID Execution。Slack payload 中的 `event_id` 会进入 `input_data`，但没有唯一约束
或已处理集合。Slack 官方/代理重试、客户端网络重发、用户双击测试，都可能生成重复 Agent Run。

`is_single_execution` 通过先 COUNT 再 INSERT 实现，并发请求可同时看到 0 后各自插入，也不是并发安全幂等。

Tessera 需要统一的 Invocation 幂等键：

```text
source = slack
source_connection_id = conn_xxx
external_event_id = Ev123
automation_id = aut_xxx
dedupe_key = hash(source, connection, event, automation)
```

数据库对 `dedupe_key` 建唯一约束；重复请求返回同一 Invocation/Run 状态，而不是再次运行。

### 5.5 HTTP 响应只确认投递，不确认执行

Webhook 创建 Execution 后发布 Pub/Sub。若 Redis 显示该用户有在线 session，接口最多等待十秒的
`delivery_confirmation`。这个 confirmation 在服务端 WebSocket worker **把 JSON 写给某个 socket 后** 就写入 Redis，
发生在桌面 ACK 和入队之前。

因此响应中的 `delivered: true` 仅表示某个 WebSocket send 成功，不表示：

- 客户端解析成功；
- ACK 成功；
- 唯一桌面领取；
- 项目队列持久化；
- Agent 开始或完成。

如果没有在线 session，接口仍返回 success，并说 execution queued；但 Pub/Sub 本身没有离线队列，所谓 queued 只是
数据库存在一个 pending Execution，客户端重连后没有读取 pending 的补偿路径。

API 应返回 `202 Accepted` 与 Invocation URL，让调用方查询状态；同步等待策略也只能等待持久队列入库或租约成功，
不能把 socket write 称为 delivered-to-executor。

## 6. Slack：专用认证与事件归一化

Slack Trigger 配置支持：

- 事件类型集合；
- channel 过滤；
- 忽略 bot 消息；
- 忽略用户集合；
- 消息正则；
- 从 Slack API 拉取 channel 列表。

标准化输入保留事件类型、时间、team、user、channel、text、thread/message timestamp、reaction、files 和 `event_id`。
renderer 把这些字段格式化到 Agent Prompt 的 “Trigger Context” 区域。

值得学习的是：外部事件没有整包粗暴拼进 Prompt，而是先归一化为稳定字段。需要改进的是：

- Slack `files` 只显示数量，没有进入统一附件下载、快照、病毒扫描和 Run Resource 绑定；
- 用户文本与外部事件内容直接进入 Prompt，未做 prompt-injection 信任标记；
- 事件来源缺少可点击的原始对象引用与引用权限；
- event_id 不参与去重；
- Handler 会记录完整 payload 的 info 日志，可能泄露消息内容。

Tessera 应把外部内容标成 `untrusted_external_content`，以结构化 ContextResource 提供给 Agent，不与系统指令混层。

## 7. Redis/WebSocket 投递协议

### 7.1 Session 注册

renderer 为当前挂载周期生成随机 `session_id`，连接 `/execution/subscribe` 后发送 JWT。服务端：

1. 验证 token 与 blacklist；
2. 把 `session_id → user_id` 写 Redis，默认 TTL；
3. 把本进程 WebSocket 放入进程内 map；
4. 启动每 worker 一条 Redis Pub/Sub listener；
5. 每 30 秒向客户端发 heartbeat。

renderer 每两分钟 ping，十秒内无 pong 标记 unhealthy，断线使用 5 秒 debounce 加指数退避，最多重试五次。基础连接
健康处理完整，但 Session TTL 是否被 heartbeat 持续刷新不清晰：Redis 工具有 `update_session_ttl`，固定主链未发现
在 ping/heartbeat 中调用。长时间连接可能仍从 Redis 用户 session 集合中自然过期，造成 socket 在线但收不到广播。

### 7.2 Pub/Sub 广播到所有用户窗口

每个 execution event 带 `user_id`。worker 从 Redis 取该用户所有 session，与本 worker 的 socket map 取交集，然后对
每个 socket 发送同一事件。发送成功后：

- 把 execution ID 加入该 session 的 pending set；
- 写 delivery confirmation；
- 继续给其他 session 发送。

这是 broadcast，而不是 competing consumers。多窗口、多设备同时在线时，每一个 renderer 都会执行：

```text
receive execution_created
    → 立刻 send ack
    → emit local event
    → create/load project
    → addQueuedMessage
```

数据库 ACK 只有第一次能把 `pending` 改为 `running`，但后续客户端并不会因为没收到 `ack_confirmed` 而撤销本地任务。
所以服务端状态看起来只有一次运行，实际可能有多个 Agent 同时执行、写同一个 Project 或工作区。

### 7.3 ACK 时机过早

renderer 在收到 JSON 的 switch 分支里先 ACK，随后才写 Activity Log 和 Zustand event。真实任务还要经过：

1. `useTriggerTaskExecutor` 找项目或从历史构造项目；
2. 格式化 Prompt；
3. `addQueuedMessage`；
4. `useBackgroundTaskProcessor` 两秒轮询；
5. 检查同项目并发、已有 SSE、暂停/确认状态；
6. 创建 Chat Task；
7. 再调用 REST 更新 `running`；
8. `startTask` 才真正开始 Agent。

因此 WebSocket ACK 更接近“通知已被 renderer 观察到”，不能作为 Execution 开始时间。

### 7.4 本地队列不是耐久队列

Trigger 消息进入 `projectStore.queuedMessages`。该队列的职责是协调 UI 项目中的后台任务，并按项目限制并发；它不是
服务端可见的 durable queue。进程崩溃、窗口关闭、store 未持久化或项目装载失败，都可能让 ACK 后的任务丢失。

优点是它复用了正常 Chat/Agent 主链，没有另外写一套 Headless Agent。这个原则值得保留：**自动化最终也应创建
标准 Run**。但控制面需要先持久化 RunRequest，再由桌面领取；不是先 ACK 再寄希望于 UI store。

### 7.5 运行完成回报

后台处理器给 Chat Task 填入 `executionId`。`chatStore` 在完成、失败、取消等多个终止分支调用
`updateTriggerExecutionStatus`，上报 `completed_at`、Token 和错误。进程内 `reportedExecutionIds` 防止重复上报，失败
会移除标记以允许后续路径重试。

这个桥接能把真实 Agent 终态投回 TriggerExecution，但：

- 去重集合不跨重启；
- Output 与 `tools_executed` 主链未见完整汇总；
- 服务端超时不会反向取消 Chat Task；
- REST 最终更新缺少 Run ID 强绑定与终态 compare-and-set；
- 一条 Execution 多窗口运行时，谁先回报决定服务端表象。

## 8. 超时、失败、重试与恢复

### 8.1 服务端超时扫描

Celery 默认每分钟扫描所有 `pending/running`：

- pending 超过 60 秒 → `missed`；
- running 超过 600 秒 → `failed`；
- 从用户所有 Redis session pending set 中删除 execution ID。

十分钟对 Agent 研究、浏览器和多文件任务明显偏短，且没有根据任务类型、模型响应或最近进度心跳延长租约。
`running` 应由 lease heartbeat 驱动，而不是固定墙钟超时。

### 8.2 超时不会停止 Agent

超时任务只改 Server DB，不向桌面发送 cancel。桌面可能仍继续消耗模型额度、调用工具和写文件，完成后再覆盖状态。
这会造成账单、权限和用户认知不一致。

Tessera 的 cancellation 必须是一条端到端协议：

```text
control plane requests cancel
    → executor observes cancellation token
    → model/tool loop 停止接受新步骤
    → 正在运行的工具按能力取消或隔离
    → workspace overlay 保留为可审查未应用状态
    → executor ACK terminal outcome
```

### 8.3 Retry 是人工新建 Execution

失败执行可通过 REST retry，新建一个 execution ID，复制 input，`attempts + 1`。这比原行反复改写好，能保留尝试
历史。但固定源码中的 `get_failed_executions_for_retry` 没看到自动调用，`max_retries=3` 主要限制人工 retry。

新 Execution 没有 `parent_execution_id` 或统一 Invocation ID，难以把多次 attempt 归成一个业务运行。建议模型：

```text
Invocation 1 ── RunAttempt 1 failed
             ├─ RunAttempt 2 failed
             └─ RunAttempt 3 completed
```

### 8.4 Consecutive failure 的边界

Execution 成功会重置 Trigger 连续失败，失败会加一并检查自动停用。`missed` 是否作为失败计数应是产品策略；当前
主要代码只在特定终态分支更新，且 rate-limited occurrence 没有 Execution，统计口径不统一。

应区分：

- source rejected；
- filtered；
- rate limited；
- scheduler missed；
- delivery failed；
- executor unavailable；
- Agent failed；
- policy denied；
- cancelled。

这些原因对应不同告警、重试和自动停用策略，不能都折叠成 consecutive failure。

## 9. Remote Control：同仓库里更成熟的调度协议

### 9.1 为什么要放在同一篇分析

用户界面把 Remote Control 放在 Dispatch/调度心智下；技术上它也是“远端发出命令，桌面 Agent/工作区执行”。更重要
的是，它已经实现了 Trigger 缺失的可靠投递骨架，是设计 Tessera Automation Executor 的直接参考。

### 9.2 稳定设备身份与会话

桌面在 localStorage 保存 `desktop_instance_id`。创建 Remote Control Session 前，UI 要求 Bridge 在线，并将 Session
绑定到：

- 用户；
- 稳定桌面实例；
- Space；
- 当前 Project/Task/Brain Session；
- 过期时间；
- capability map；
- bridge online/offline 状态。

分享链接的 token 优先放 URL fragment，不随首次 HTTP 请求自动泄漏；服务端只存 token hash，并记录首次使用次数、
过期与撤销。登出、改密码会批量撤销远控 Session。WebSocket 还校验 Origin、JWT blacklist，并带连接限流。

这比 Trigger 的“发给用户所有窗口”更接近明确执行目标。

### 9.3 持久命令状态机

`RemoteControlCommand` 保存：

```text
id / session / user / source_channel / type / payload
space / target project / target task / brain session
next_task_id
pending → delivered → acknowledged | failed | expired
delivered_at / acknowledged_at / error_code / error
```

服务端先提交 command row，再 Pub/Sub 到该 `desktop_instance_id` 的 channel。Pub/Sub 仍是瞬时传输，但数据库才是
事实源。

### 9.4 重连补投与后台修复

Bridge 连接建立后，服务端查询该设备所有活跃 Session 中的 pending commands，按创建时间补发。后台 worker 还会：

- 30 秒后重新发布 stuck pending；
- pending/delivered 超时后标记失败；
- Redis Bridge TTL 失效后把 Session 标 offline；
- 对项目切换失败执行带当前值检查的补偿恢复。

因此“先数据库，后消息；重连读数据库补发”的控制面比 Trigger 更可靠。

### 9.5 桌面幂等

桌面 `useRemoteControlBridge` 以 `command.id` 维护缓存：

- 已完成命令重投时复用原 ACK；
- 正在执行命令重投时复用同一 Promise；
- 首次收到先发 `command_delivered`，完成后发 `command_ack`；
- 重连采用带 jitter 的指数退避；
- 本地对高频命令有限流。

缓存仍是进程内的，桌面崩溃后不保证 exactly-once；但配合服务端命令状态和业务对象 ID，已经是可靠执行器的可用
雏形。

### 9.6 仍需警惕的远控边界

- `desktop_instance_id` 存 localStorage，清缓存会换身份，复制 profile 可能复制身份；
- command ACK 缓存不持久，崩溃恢复后的副作用工具仍需业务级幂等；
- Pub/Sub + 本地 worker 不是通用 durable broker；
- Session 同时保留 legacy 与 current/last target 字段，存在迁移期双写复杂度；
- Remote Web 可以触发 Agent 和工作区动作，能力 token 与高风险审批需要更细粒度；
- 后台 worker 由 WebSocket 入口触发，部署拓扑与单例保证需要谨慎核验。

Tessera 应学习协议结构，不照搬具体 Redis/进程内 worker 实现。

## 10. Trigger 与 Remote Control 的源码级对照

| 维度 | Trigger Execution | Remote Control Command | Tessera 应选 |
| --- | --- | --- | --- |
| 目标 | `user_id` 下所有 session | 明确 `desktop_instance_id` | 执行池 + 明确 lease holder |
| 事实源 | DB 有 Execution，投递仍靠广播 | DB Command 是投递事实源 | DB RunRequest/Lease |
| 离线补偿 | 无 | 重连 flush pending | 必须有 |
| 去重 | 无消费者去重 | 桌面按 command ID 缓存 | 持久 idempotency + 本地缓存 |
| 投递状态 | socket send confirmation | pending/delivered/ack | accepted/leased/started/terminal |
| 多窗口 | 全部窗口执行风险 | 定向到一个桌面 ID | 单 lease，显式 takeover |
| 超时 | 固定 pending/running 墙钟 | 分 pending/delivered ACK timeout | lease heartbeat + deadline policy |
| 补偿 | 无 | target switch 条件回滚 | 领域补偿，不回滚未知新状态 |
| 可观测性 | Execution + Activity Log | Command + Event + status stream | Invocation/Attempt/Run/Event |

**研究推断：** Eigent 的 Remote Control 很可能是后续开发的新链路，已吸收 Trigger 真实使用中暴露的可靠性问题。
即使不判断时间顺序，两者对照也足以说明：Trigger 的广播模式不应成为 Tessera 自动化基础。

## 11. UI 与产品心智

### 11.1 值得学习的部分

- Schedule 不要求用户手写 Cron，提供单次/日/周/月和未来时间预览；
- Trigger 按 Project 归属，不是漂浮在全局的脚本；
- Webhook URL、验证状态、活动历史与连接健康在界面可见；
- 配置 schema 带 `ui:widget`、label、notice、API data source，支持动态生成 Slack 等表单；
- Remote Control 从 Workspace Dispatch 创建，明确要求桌面在线，并能停止单条或全部分享链接；
- Remote 页面把 Agent 步骤流投给远端用户，而不是只给一个“已提交”按钮。

### 11.2 容易误导的部分

- UI 的“queued”会让用户以为离线任务会在上线后执行，源码没有补投；
- Webhook `delivered=true` 容易被理解为 Agent 已领取，实际只是 socket write；
- Trigger 中可选 `agent_model/listener_type`，但桌面最终沿当前项目普通 Chat 链运行，未见完整冻结与消费；
- Schedule UI 本地时间友好，但没有暴露 timezone/DST 策略；
- 执行失败可能来自桌面离线、投递、超时或 Agent，本质不同却在列表中较扁平；
- Remote Control 与 Trigger 使用两套 Session/Execution 协议，用户看不到它们的可靠性差异。

Tessera UI 应围绕真实状态命名：`等待执行器`、`已租用`、`运行中`、`等待审批`、`重试中`、`错过日程`、
`已取消但清理中`，并在详情中显示执行位置、设备、Run、输入快照和下一步恢复操作。

## 12. 安全与信任边界

### 12.1 外部内容不是指令

Webhook/Slack body 属于不可信外部输入。直接把它格式化进 Markdown Prompt，可能包含“忽略之前指令、读取文件并
发送”等 prompt injection。系统应：

- 用结构化 message part 区分系统目标与外部 payload；
- 给 Agent 明确的来源/信任标签；
- 外部事件不得扩大工具、文件、浏览器和网络权限；
- 高风险写入仍走审批；
- payload 大小、嵌套深度、文件数量和下载域名受限。

### 12.2 Secret 与连接引用

Trigger 定义不应保存 Slack Token、Webhook Secret 等值，只保存 `connection_id`。执行时由主进程/安全服务解析
成最小能力，renderer 和 Prompt 都不接触 Secret。

Webhook URL UUID 只能算不可猜测地址，不是认证。通用 Webhook 至少应支持：

- HMAC 签名与时间窗；
- 可轮换 Secret；
- IP/网络策略作为附加条件；
- 重放检测；
- 每 Automation 独立 rate limit；
- 一键撤销旧 endpoint。

### 12.3 自动化权限必须预授权但不能无限授权

无人值守任务无法临时询问所有动作。需要在 Automation 保存一份 **权限上限**，Run 冻结后仍由运行时逐次校验：

```text
allowed skills / MCP tools
allowed workspace scope
network destinations
browser identity
write mode: draft-only | auto-apply-safe | require-review
spend / token / wall-clock budgets
human escalation channel
```

不能因为某个手工 Run 曾批准写文件，就让未来所有 Schedule 永久继承。

## 13. Tessera 当前对照

在当前 Tessera 代码与 `docs/architecture/` 中，没有发现业务级 Schedule、Cron、Webhook、Slack Trigger、Remote
Control 或 Automation 领域对象。搜索命中的 `schedule/trigger/dispatch` 主要是编辑器同步、React primitive 和浏览器
事件，不构成 Agent 调度能力。

但 Tessera 已有可复用基础：

| 基础 | 当前状态 | 对调度的价值 |
| --- | --- | --- |
| Workspace/Project/Task/Run 心智 | 部分实现 | Automation 可明确绑定目标，而非创建隐式工作目录 |
| Agent Runtime | 部分实现 | 自动化最终复用标准 Run，不另造 Headless Agent |
| 模型/供应商能力 | 部分实现 | RunRequest 可冻结模型和工具兼容性 |
| MCP/Skills | 部分实现 | 权限上限与运行能力选择有对象基础 |
| Run Inspection/审计 | 部分实现 | 可承接自动化来源、执行位置、事件和结果 |
| 窄 IPC 与 renderer 无 Node | 已有约束 | 调度器、Secret、文件与执行器不落 renderer |
| 工作区写入审批/差异预览 | 规划/部分实现 | 无人值守任务可保留 draft，等待用户审查 |

Tessera 当前的优势是还没有背负兼容债务，可以直接把自动化建在 Run 之上，而不是先建一套 TriggerExecution 再靠
renderer 映射回 Chat Task。

## 14. Tessera 目标架构

### 14.1 核心对象

```text
AutomationDefinition
├── id / owner / scope
├── source adapter + source config
├── target Project / Run template
├── permission envelope
├── model/capability policy
├── schedule timezone/misfire policy
├── retry/deadline/budget policy
└── enabled/version

Invocation
├── id / automation_id / definition_version
├── source / external_event_id / dedupe_key
├── received_at / scheduled_for
├── normalized input resource refs
├── filter/rate-limit decision
└── state

RunRequest
├── invocation_id
├── frozen RunContext snapshot
├── execution_target policy
├── priority / deadline
└── status

ExecutionLease
├── run_request_id
├── executor_id / device_id
├── lease_token / fencing_token
├── leased_at / heartbeat_at / expires_at
└── attempt

Run
└── Tessera 标准 Agent Run、事件、Artifact、审批和终态
```

### 14.2 为什么需要 fencing token

桌面 A 获得 lease 后断网，控制面超时并把 lease 给桌面 B；A 随后恢复。如果只靠 execution ID，A/B 都可能继续写
状态。每次 lease 应递增 fencing token，Run 状态更新和高风险副作用必须携带当前 token。旧 token 的迟到写入被拒绝。

这比“先 ACK 的窗口赢”更能处理真实断网和重连。

### 14.3 执行位置策略

Automation 必须显式选择：

| 策略 | 用途 | 离线行为 |
| --- | --- | --- |
| `this-device` | 需要本机文件、Cookie、桌面应用 | 等待该设备、错过或按策略通知 |
| `any-trusted-device` | 用户多台可信桌面 | 单 lease 竞争领取 |
| `local-service` | Tessera 后台进程可运行的轻任务 | UI 关闭仍可执行 |
| `remote-runner` | 云端无本机资源任务 | 远端沙箱执行 |
| `manual-review` | 只生成草稿/计划 | 创建待审查 Run，不自动执行工具 |

不能把“用户有任意 WebSocket 在线”当作执行条件。

### 14.4 统一事件适配器

```ts
interface InvocationAdapter {
  verify(request: RawEvent, connection: ConnectionRef): VerificationResult
  deriveIdempotencyKey(request: RawEvent): string
  normalize(request: RawEvent): NormalizedInvocation
  filter(input: NormalizedInvocation, definition: AutomationDefinition): Decision
  redactForAudit(input: NormalizedInvocation): RedactedPayload
}
```

Schedule 也实现同一接口，只是原始事件来自内部 Scheduler。这样 webhook/slack/file-watch/remote-command 最终都走
相同的 Invocation、RunRequest、Lease 和 Run 链路。

### 14.5 控制面与执行面

```text
Control Plane（main/后台服务）
  Scheduler / Webhook Receiver / Connector
       ↓ transaction + outbox
  Invocation DB → RunRequest Queue → Lease Coordinator
       ↑                            ↓
  Run/Event projection ← Executor heartbeat/status

Execution Plane（agent-runtime）
  claim lease → hydrate frozen RunContext → standard Run
       → model/tools/approval/artifacts → terminal ACK
```

在单机第一阶段，可以用 SQLite + 唤醒机制实现，不必先引入 Redis/Celery。但事务 outbox、唯一键、lease 和重启恢复
语义仍要存在，未来换成云队列时领域模型不变。

## 15. 建议实施顺序

### 阶段 A：本地一次性/周期 Automation 骨架

1. 定义 Automation、Invocation、RunRequest、Lease 合同与 SQLite migration；
2. 只支持 `this-device` 和一次性/每日 Schedule；
3. 保存 IANA timezone、misfire policy、deadline；
4. main 进程调度，renderer 只读投影和发命令；
5. 每个 occurrence 用 `(automation_id, scheduled_for)` 唯一键；
6. 领取后创建标准 Tessera Run；
7. 应用重启恢复 pending/leased RunRequest；
8. 首版写入只允许 draft/overlay，不自动 apply。

验收：关闭 renderer、重启应用、系统睡眠跨过日程、多开窗口时，每个 occurrence 最多只有一个 Run；错过策略可解释。

### 阶段 B：可靠执行与 Run Inspection

1. lease heartbeat、fencing token、取消与迟到结果策略；
2. Invocation → Attempt → Run 的可点击链路；
3. Progress、实际能力、文件变更、审批和执行设备进入 Inspection；
4. 重试按 attempt 建新记录，保留 parent；
5. 预算、工具、网络、工作区权限上限；
6. 系统通知与待人工处理队列。

验收：强杀执行器、断网、lease 转移、旧执行器恢复时，不会重复提交副作用或覆盖新状态。

### 阶段 C：Webhook 与 Connector Trigger

1. 通用 HMAC Webhook；
2. body/header/query 大小与 schema 限制；
3. idempotency/replay window；
4. payload 快照为 ContextResource，带 untrusted 标记；
5. 返回 202 与可查询 Invocation 状态；
6. 再实现 Slack/GitHub 等专用 adapter；
7. 外部附件进入统一下载、扫描、快照、引用链。

验收：同一外部 event 重试十次只产生一个 Invocation；Secret、Cookie、Authorization 不进入 renderer/Prompt/普通日志。

### 阶段 D：远程控制与多执行器

1. 稳定 Device Identity 与设备批准；
2. Session capability token、到期、撤销和审计；
3. 远端命令也创建标准 Invocation/Run；
4. pending command 重连补投与 executor 去重；
5. `this-device/any-trusted-device/remote-runner` 策略；
6. 远端实时步骤只投影脱敏 Run Event。

验收：分享链接撤销、登出、改密码、设备移除立即收回能力；跨进程重连不会重复执行命令。

## 16. 明确吸收与不采纳

### 建议吸收

- Trigger Definition 与 Execution History 分离；
- Schedule 的自然选项和未来时间预览；
- App Handler 的认证/过滤/归一化分层；
- 外部 Secret 与 Trigger JSON 分离；
- 自动停用、速率、单次任务、执行历史等治理入口；
- 自动化最终复用标准 Agent Run；
- Remote Control 的稳定设备定向、持久命令、重连补投、命令 ID 去重、ACK 与条件补偿；
- 远端步骤流和 Workspace/Project target 的产品心智。

### 不建议采纳

- 用 Redis Pub/Sub 充当离线任务队列；
- 对用户全部在线窗口广播执行；
- socket send 后就称为 delivered；
- renderer 收到事件即 ACK，再写本地临时队列；
- 固定十分钟 running timeout；
- 超时只改服务端状态而不取消 Agent；
- 只存 UTC Cron、不存用户时区和 DST 策略；
- Schedule rate limit 跳过却不留 occurrence 记录；
- Webhook/Slack 缺少幂等与重放保护；
- 通用 Webhook `authentication_required` 只有配置字段没有真实验证；
- 让外部 payload 与 Agent 指令处于同一信任层；
- Trigger、Remote Control 各自维护独立执行协议。

## 17. 对 Tessera 的最终判断

Eigent 证明了“调度不是一个 Cron 输入框”：它牵涉长期定义、外部连接、任务输入、执行位置、项目恢复、后台排队、
Agent 终态、失败治理和可见历史。它的 UI 和类型配置值得借鉴，Trigger 主链则更像产品验证期实现。

Eigent 同仓库里的 Remote Control 已经给出升级方向：**消息可以瞬时，命令事实必须持久；连接可以重建，执行身份
必须稳定；投递可以重试，副作用必须去重；状态可以超时，真实 Run 必须协调取消。**

Tessera 最合适的路线不是先做一个独立“定时任务模块”，而是补齐标准 Run 的持久 RunRequest、Lease 与恢复协议，
再把 Schedule/Webhook/Slack/远控作为多个 Invocation Adapter 接入。这样后续 Skills、MCP、浏览器、工作区与多
Agent 都沿同一权限和审计边界运行，不会再出现两套甚至三套任务生命周期。
