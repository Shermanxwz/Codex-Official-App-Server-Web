# Official Codex App Server Web

[English](README.md)

一个自托管的 **OpenAI 官方 Codex App Server Web Host**。浏览器不重新实现 Codex Runtime：网关启动官方 `codex app-server`，从当前 Codex 二进制生成官方协议，再提供原生 Thread / Turn / Item Web UX 和全量 schema 驱动的官方接口调用面。

## v0.4.0 封存边界

- **只使用官方 App Server：**Linux 安装器把官方 `codex app-server --listen ws://127.0.0.1:43999` 作为独立 user service 运行，Web 网关通过官方 WebSocket 接入；便携手动启动仍支持 stdio 兼容模式。
- **不维护手写 ClientRequest 白名单：**启动时同时生成官方 JSON Schema 与 TypeScript；JSON wire method 没有对应 TS 导出就 fail closed。
- **Stable ClientRequest / ClientNotification 全量覆盖：**`initialize` / `initialized` 由网关管理，其余官方导出方法全部经过 schema gate，可从原生 UI 或“官方接口”面板调用。
- **ServerRequest 有明确宿主处置：**审批、用户输入、MCP elicitation、权限、Dynamic Tool，以及 experimental 外部时钟请求都进入明确 Host 流程；平台专属 token refresh / attestation 不进入浏览器信任边界。
- **MCP Apps Host：**正式声明 `io.modelcontextprotocol/ui` + `text/html;profile=mcp-app`，实现稳定 `2026-01-26` Host 协议，并按规范使用 Web 必须的双 iframe sandbox。
- **Dynamic Tool 自动 Host：**可选本机 process handler 通过官方 experimental `thread/start.dynamicTools` 自动注入；执行不经过 shell，并限制环境变量、超时、请求与输出大小。未配置或未匹配的 Dynamic Tool 由官方协议返回 `-32601`，不会伪造审批 UI。
- **Stable + Experimental 双协议封存：**CI 同时重新生成两套官方协议；Pinned 基线里只要新增 ThreadItem / ServerRequest 没有明确处置就直接失败。每个 schema 允许的 ServerNotification 都会先进入有界“官方事件”日志，包括不适合进入对话时间线的通知。
- **运行时 npm 依赖为 0。**要求 Node.js 22.12+。
- **不接私有 ChatGPT backend，不抓 Codex 凭据，不直接修改 `auth.json` / `config.toml`，不安装/升级 Codex，不做 process-wide kill。**

封存基线固定为官方 `@openai/codex` **0.150.1**，并已用真实登录账号完成模型 Turn、持久化 `thread/turns/list` 与 `thread/items/list` 读取验证。如果目标是“封存后不再维护”，就固定运行这个精确版本。CI 仍会用 `@latest` 做 advisory canary；未来官方若改变协议，项目会检测出来，但任何静态第三方项目都不能诚实承诺对所有未来未发布版本永远无需维护。

精确边界见 [封存契约](docs/ARCHIVE_CONTRACT.md)、[协议一致性](docs/PROTOCOL_PARITY.md)、[产品级 Host](docs/HOSTS.md)。

## 全量特性总览

| 领域 | 已实现能力 |
| --- | --- |
| 官方协议 | 启动时从官方 Codex 二进制生成 JSON Schema 与 TypeScript 契约，支持 Stable/Experimental 协商，schema gate 失败即关闭；覆盖当前官方 ThreadItem，为每个官方 ServerNotification 提供有界观察日志，并提供“官方接口”面板调用其余导出方法。 |
| 会话体验 | 会话列表、新建/读取/列表/恢复，官方重命名/归档/取消归档/删除，模型与推理强度，官方图片输入，停止任务，实时调整方向，上下文压缩，以及官方 Turn 耗时。 |
| 无人值守执行 | 侧栏提供显式的“无人值守”开关；开启后将官方 `approvalPolicy:'never'` 与 `danger-full-access` 接到新建、恢复、设置、Turn 和命令执行路径，关闭后恢复官方默认审批。 |
| 快速会话 | 快速会话显示最近 10 条 Turn；先用官方 `itemsView: notLoaded` 读取轻量结构，再通过官方 `thread/items/list`、有界并发自动补齐这 10 条的会话内容和工作过程。如果运行时拒绝了已声明的可选历史接口，网页会触发一次性兼容回退，改用稳定的 `thread/read`，并隐藏不可用的分页控件。 |
| 历史完整会话 | 只有历史完整会话会沿官方游标逐页读取更早内容；更早 Turn 的会话内容和工作过程按 Turn、按可视区或明确操作懒加载，快速会话不显示更早分页按钮。 |
| 会话搜索 | 使用官方 `thread/searchOccurrences` 分页和官方匹配摘要进行完整历史关键词搜索，并补充已经渲染的工作过程文本。 |
| 实时运行 | 每个 SSE 客户端独立队列、数据心跳、断线重连与权威重同步、官方活动状态、实时 Item/delta、运行读秒、常驻官方计划卡片、终态核对，以及 Turn 完成后保留已收到的工作过程。 |
| 可靠发送 | 官方 `clientUserMessageId`、乐观显示、输入框立即清理、可持久化“正在确认”、有界权威核对，以及 10 分钟结果去重缓存，避免响应丢失后的重试产生重复 Turn。 |
| 共享历史 | 只保留一个持久化的“网页写入”开关。其他官方客户端运行时网页仍可查看；是否允许并发写入由官方 App Server 决定，不再增加额外的桌面占用保护。 |
| MCP Apps | 稳定 MCP Apps `2026-01-26` Host、官方资源/工具代理、可见性校验、不透明源双 iframe 沙箱、CSP/权限控制，以及有界 JSON-RPC bridge。 |
| Dynamic Tools | 可选的 experimental 本机进程 Host，使用官方 `thread/start.dynamicTools`、`shell:false`、stdin JSON、严格资源边界；未匹配工具由官方返回 `-32601`。 |
| 安全与运维 | 默认鉴权、写入 exact-origin 防护、访问配置、资源队列上限、凭据/环境隔离、Linux 独立托管官方 App Server，以及便携 stdio 启动模式。 |

项目明确不调用 ChatGPT 私有接口、不复制 Codex 凭据或历史文件、不安装/升级 Codex，也不终止无关 Codex 进程。协议行为、账号状态、会话持久化、并发写入和上游限制始终由官方 App Server 负责。

## 架构

```text
浏览器
  | 同源 HTTP + SSE
  | MCP App Host bridge
  v
Official Codex App Server Web
  | 官方 JSON/TS schema + access-profile gate
  | 有界 Dynamic Tool process host
  | 官方 WebSocket（Linux service）/ stdio JSONL（便携模式）
  v
codex app-server
  | Thread / Turn / Item / MCP / approvals / models / account
  v
官方 Codex Runtime

MCP App：
Host 页面
  -> 外层 Sandbox Proxy（opaque data: origin；allow-scripts + allow-same-origin）
     -> 内层不可信 App iframe（allow-scripts + allow-same-origin + allow-forms；仍由外层跨源 Proxy 与产品 Host 隔离）
```

## Web 产品能力

网页新建会话在固定运行时声明分页接口时，会明确请求官方 `historyMode:'paginated'` 契约。已有的 `legacy` 会话仍然是官方会话，网页改用稳定的 `thread/read(includeTurns:true)` 读取，并对它隐藏实验性分页控件。

快速会话的显式会话选择会绕过旧浏览器缓存，重新读取官方最近 10 条摘要页，并显示快速视图边界；SSE 新连接会接收网关保存的有界活动官方计划快照，终态或空计划会清理它。

原生界面包括历史/read/resume、官方 `thread/turns/list` 摘要分页、按 Turn 通过 `thread/items/list` 读取完整项、侧边栏“历史完整会话”模式、完整历史关键词筛选、实时 Turn/Item、流式 delta、模型与 reasoning、官方 Turn 处理时长、interrupt、命令/文件/权限审批、用户输入、MCP elicitation、断线权威重同步，以及 MCP App 渲染。执行项会像 Codex 一样收进默认折叠的“工作过程”，主回答保持在对话主线上；官方返回非空计划时，计划卡固定在输入框上方，桌面端悬停/聚焦查看步骤，触屏端点击展开；活动 Turn 中继续输入会走官方 `turn/steer` 调整方向，手动上下文整理走官方 `thread/compact/start`，并显示压缩动画。运行中标题和运行指示跟随官方 Turn/线程活动事件，包括不携带 `turnId` 的官方线程级 active 状态；停止、调整方向、上下文用量和网页写入权限仍只属于持有本地 Turn 标记的网页标签。即使只丢失 `turn/completed`，网页也会用有界的官方只读核对清除本地运行状态，空闲时不伪造运行状态。能力摘要读取官方 MCP、Skills 和已安装 App 清单；仍在开发中的官方 Plugin 清单与生命周期接口（`plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall`）只有在 experimental 模式开启时才读取。其余不常用官方方法仍可在 **官方接口** Drawer 中按当前官方 schema 直接调用。发送消息会携带官方 `clientUserMessageId`；如果官方已接受但响应在网络中丢失，输入框会立即清空并进入可持久化的“正在确认”状态，再通过官方分页会话列表核对，而不是允许误发重复消息。网关还会为相同会话与官方消息标识保留有界十分钟结果缓存，用户明确重试时可恢复丢失的响应而不重复向上游发送。运行时长依据官方开始时间实时读秒，终止 Turn 替换摘要表示时会保留已经收到的工作过程。

侧栏“写入控制”同时提供“网页写入”和“无人值守”两个独立开关。无人值守只在网页可写且当前官方 schema 导出所需字段时生效；它不修改 `auth.json` / `config.toml`，而是由网关在官方 RPC 进入 App Server 前附加对应的官方执行策略。用户输入、MCP elicitation、第三方工具的副作用确认等并非普通命令审批的官方请求仍按协议显示交互卡片。点击左上角 Codex 标志或顶部右侧的首页图标可返回首页，不会删除官方会话。

共享历史遵循单写入者边界：选择会话和重连恢复只使用官方 `thread/read` 与分页读取，不自动 `thread/resume`；只有明确发送或管理操作时才尝试写入。网页不再额外增加“桌面占用保护”闸门：官方活动只负责真实显示运行状态，只有官方实际返回 active-writer 冲突时，网页才临时进入只读并在任务结束后恢复。侧栏只保留默认开启的“网页写入”开关，并由官方 App Server 决定并发写入是否被接受。会话菜单使用官方 `thread/name/set`、`thread/archive`、`thread/unarchive`、`thread/delete`，不直接改历史文件。

当前固定的 Codex 官方协议提供 `thread/turns/list`、`thread/items/list` 分页和 `thread/searchOccurrences` 官方全文检索。快速会话固定只显示最近 10 条 Turn：底层先用官方 `itemsView: notLoaded` 分页限制首屏读取，然后自动通过官方 `thread/items/list`、以并发上限 2 补齐这 10 条 Turn 的会话内容和工作过程，不提供“加载更早会话”控件；需要更早内容时进入“历史完整会话”。完整历史模式按页运行：先立即显示最近一页会话结构，历史控件和页码标识吸附在顶部，只有用户明确加载更早内容或搜索命中更早会话段时才继续读取对应 Turn 分页；只有更早历史 Turn 的会话内容和工作过程通过官方 `thread/items/list` 按 Turn 懒加载，只在接近可视区或明确点击加载按钮时读取。活动 Turn 不会被快速会话懒加载排除，实时 SSE 项和乐观用户消息在官方内容追上前保持可见。搜索以官方 occurrence 索引为主，直接展示官方匹配摘要，并补充已经渲染的工作过程文本，不伪造 ChatGPT 私有接口。侧栏刷新、配置同步和搜索读取会合并/取消重复请求，避免挤占官方传输槽位。每一页和每个 Turn 的项分页单独请求，遇到大页还会自动降为更小分页重试，整段会话不会被拼成一条 128 MiB JSONL。分页消除了“整段会话启动读取”的聚合阈值；但单个异常巨大的官方 Turn 或项分页仍可能触发传输安全闸门，需要先由官方压缩上下文。

每次网关启动都会生成运行代际标识，并同时通过 `/api/meta`、SSE `connected` 帧提供。浏览器在 SSE 断线重连、页面重新获得焦点或检测到代际变化时，只用官方权威历史重新读取页面，不会因为恢复页面而尝试抢占会话；`thread/resume` 仅在明确的网页写入动作中调用。若官方返回 active-writer 冲突，网关返回明确的只读状态，网页不会把它伪装成 502。Linux 安装器把官方 App Server 放在独立的 `codex-official-app-server.service` 中，网关重启不会终止官方 Turn；断线期间没有缓存的增量不会被伪造重放。若官方 App Server 自身被停止、崩溃或机器关机，操作系统仍会终止正在生成的 Turn；官方协议没有把已被终止的模型生成凭空续跑的接口。

独立 App Server 不会自动继承桌面 Codex 的内置浏览器会话。本项目不捆绑、不模拟、也不注册自定义浏览器 MCP 服务。外部 MCP 服务必须由官方 Codex Runtime 配置提供，网页只透传官方 `mcpServerStatus/list`、`mcpServer/resource/read` 和 `mcpServer/tool/call`。未配置浏览器能力时，网页会显示未配置，不伪造工具；桌面 Browser/Computer Use 仍属于宿主提供的能力。

外部 MCP 服务请使用官方 Codex CLI（`codex mcp list` / `codex mcp add`）配置；本项目不会写入 Codex 配置。修改 MCP 配置后请重启官方 App Server。

`CWEB_CODEX_TRANSPORT=websocket` 与 `CWEB_CODEX_SERVER_URL` 控制持久官方传输。WebSocket 端点只接受 loopback `ws(s)` 地址，官方服务单元不接收 Web 会话令牌或其他 `CWEB_*` 配置。当前上游 App Server 文档将 WebSocket 传输标为 experimental，且不建议用于生产；若要遵守这一支持边界，请使用便携 stdio 路径。`npm start` 未安装独立服务时仍默认为 stdio；要获得重启后继续接管的行为，应使用 `scripts/install-linux.sh` 安装的双服务部署。

网关不把聊天历史、模型输出或运行日志复制到项目目录；持久会话数据仍由官方 Codex Runtime 管理。项目只维护官方 schema 缓存，启动时会自动删除自己生成且已过期的 schema 交换 `.tmp/.bak` 临时物；`scripts/prune-state.mjs` 可手动执行同一清理。它不会自动删除 `~/.codex` 中的官方会话历史，避免误删用户数据。

## 环境要求

- 官方 Codex CLI 支持的 OS
- Node.js 22.12+
- 已安装可运行的官方 `codex`
- 需要账号能力时，按官方流程登录 Codex

## 本机运行

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

打开 `http://127.0.0.1:4173`。

远程访问请放在 Tailscale、SSH tunnel 或可信 HTTPS 反代之后，不要裸露原始未认证 HTTP。

## 产品 Host 配置

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `CWEB_HOST` | `127.0.0.1` | HTTP bind |
| `CWEB_PORT` | `4173` | HTTP 端口 |
| `CWEB_CODEX_BIN` | `codex` | 官方 Codex 可执行文件 |
| `CWEB_CODEX_TRANSPORT` | `stdio` | `stdio` 或 `websocket`；Linux 安装器默认写入 `websocket` |
| `CWEB_CODEX_SERVER_URL` | `ws://127.0.0.1:43999` | 独立官方 App Server 的 loopback WebSocket 地址 |
| `CWEB_WORKSPACE` | 当前目录 | 初始工作区 |
| `CWEB_REQUIRE_AUTH` | `1` | Web 鉴权 |
| `CWEB_TOKEN` | 空 | 开启鉴权时必填 |
| `CWEB_PUBLIC_ORIGIN` | 空 | 可信公网 exact origin |
| `CWEB_ACCESS_PROFILE` | `full` | `read` / `coding` / `admin` / `full` |
| `CWEB_AUTONOMOUS_MODE` | `0` | 网关启动时无人值守开关的默认值；也可在网页侧栏中持久化切换 |
| `CWEB_EXPERIMENTAL` | `1` | 开启官方 experimental API（分页历史依赖此官方握手）；设为 `0` 可强制仅稳定协议回退。即使开启了 experimental，只要运行时拒绝已声明的可选历史接口，也会自动切换本次 Web 进程的稳定 `thread/read`，不会循环重试 |
| `CWEB_MCP_APPS` | `1` | 声明并渲染稳定 MCP Apps 扩展 |
| `CWEB_MCP_APP_PERMISSIONS` | 空 | 可选权限 allow-list；最终仍受浏览器 secure-context / Permissions Policy 约束 |
| `CWEB_DYNAMIC_TOOLS_FILE` | 空 | Dynamic Tool Host v1 JSON；要求 `CWEB_EXPERIMENTAL=1` |
| `CWEB_NOTIFICATION_OPT_OUT` | 空 | 明确要抑制的 App Server notification；默认所有官方通知都进入有界事件观察器，而聚合 Diff 和 moderation bookkeeping 仍不会进入对话时间线 |
| `CWEB_STATE_DIR` | XDG state | 项目 schema/cache 与网页写入控制状态；官方会话仍由 Codex Runtime 管理 |
| `CWEB_SCHEMA_REFRESH` | `1` | 启动时重新生成官方协议 |

MCP Apps 和 Dynamic Tool 的详细契约见 [docs/HOSTS.md](docs/HOSTS.md)。

## Linux user service

```bash
./scripts/install-linux.sh
```

安装器只写项目自己的 XDG config/state 与两个 systemd user service；会复用现有官方 Codex 可执行文件启动独立 App Server，但不会安装、升级、登录或直接修改 Codex。当前终端显式提供的代理值会更新 mode-`600` 服务环境，显式空值会清除旧设置，未提供时保留上次可用值。官方 App Server 环境只从代理白名单重建，绝不会接收 Web token 或其他 `CWEB_*` 配置。

如果机器上同时存在多个官方 Codex 可执行文件，可用绝对路径固定封存基线运行时。这个参数会更新已有 Web 运行时配置，同时保留访问令牌和其他运维设置：

```bash
CWEB_PUBLIC_ORIGIN=https://codex.example.com \
CODEX_BIN_OVERRIDE=/absolute/path/to/codex \
./scripts/install-linux.sh
```

`CWEB_PUBLIC_ORIGIN` 必须是末尾不带 `/` 的规范公网 Origin；设置后，HTTPS 登录 Cookie 会带 `Secure`，写入校验也会固定到该 Origin，不再依赖转发的 Host。未传运行时 override 时，安装器从 `PATH` 查找 `codex`；它不会安装或升级 Codex。

## 封存检查

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
npm run audit:official
npm run smoke:runtime
npm run smoke:gateway
npm run seal:core
npm run seal
```

CI 包括：完整测试/静态检查、Stable/Experimental 官方接口审计、Pinned Stable 官方协议封存、Pinned Experimental 官方协议封存、Latest Stable+Experimental advisory canary。

`npm run smoke:runtime` 会启动所选的精确官方 App Server 二进制，验证账号/模型 RPC 与分页会话生命周期；在部署主机设置 `CWEB_RUNTIME_SMOKE_MODEL_TURN=1` 后，还会执行真实模型 Turn、读取持久化 Turn/items、核对唯一助手标记并删除测试会话。`npm run seal` 验证其余官方 RPC 面。测试不会把未执行的真实账号 E2E 冒充成已验证。

`npm run smoke:gateway` 会通过已经部署的 HTTP/SSE 网关重复同一证明。配置 `CWEB_GATEWAY_URL`、`CWEB_GATEWAY_ORIGIN`、`CWEB_GATEWAY_TOKEN` 与 `CWEB_GATEWAY_MODEL_TURN=1` 后，它还会检查登录 Cookie 属性、错误 Origin 拒绝、SSE connected/heartbeat、远程部署时的 Cloudflare、持久化历史、测试会话清理与退出，且不会打印 token 或 session cookie。

## 与 OpenAI 的关系

这是基于 OpenAI 官方 Codex 接口的独立客户端，不代表 OpenAI 官方背书；项目刻意不调用 ChatGPT 私有 backend。
