# Official Codex App Server Web

[English](README.md)

一个自托管的 **OpenAI 官方 Codex App Server Web Host**。浏览器不重新实现 Codex Runtime：网关启动官方 `codex app-server`，从当前 Codex 二进制生成官方协议，再提供原生 Thread / Turn / Item Web UX 和全量 schema 驱动的官方接口调用面。

## v0.4.0 封存边界

- **只使用官方 App Server：**Linux 安装器把官方 `codex app-server --listen ws://127.0.0.1:43999` 作为独立 user service 运行，Web 网关通过官方 WebSocket 接入；便携手动启动仍支持 stdio 兼容模式。
- **不维护手写 ClientRequest 白名单：**启动时同时生成官方 JSON Schema 与 TypeScript；JSON wire method 没有对应 TS 导出就 fail closed。
- **Stable ClientRequest / ClientNotification 全量覆盖：**`initialize` / `initialized` 由网关管理，其余官方导出方法全部经过 schema gate，可从原生 UI 或“官方接口”面板调用。
- **ServerRequest 有明确宿主处置：**审批、用户输入、MCP elicitation、权限、Dynamic Tool，以及 experimental 外部时钟请求都进入明确 Host 流程；平台专属 token refresh / attestation 不进入浏览器信任边界。
- **MCP Apps Host：**正式声明 `io.modelcontextprotocol/ui` + `text/html;profile=mcp-app`，实现稳定 `2026-01-26` Host 协议，并按规范使用 Web 必须的双 iframe sandbox。
- **Dynamic Tool 自动 Host：**可选本机 process handler 通过官方 experimental `thread/start.dynamicTools` 自动注入；执行不经过 shell，并限制环境变量、超时、请求与输出大小。未配置的 Dynamic Tool 仍保留 Web 手动 fallback。
- **Stable + Experimental 双协议封存：**CI 同时重新生成两套官方协议；Pinned 基线里只要新增 ThreadItem / ServerRequest 没有明确处置就直接失败。
- **运行时 npm 依赖为 0。**要求 Node.js 22.12+。
- **不接私有 ChatGPT backend，不抓 Codex 凭据，不直接修改 `auth.json` / `config.toml`，不安装/升级 Codex，不做 process-wide kill。**

封存基线固定为官方 `@openai/codex` **0.149.1**。如果目标是“封存后不再维护”，就固定运行这个已验证版本。CI 仍会用 `@latest` 做 advisory canary；未来官方若改变协议，项目会检测出来，但任何静态第三方项目都不能诚实承诺对所有未来未发布版本永远无需维护。

精确边界见 [封存契约](docs/ARCHIVE_CONTRACT.md)、[协议一致性](docs/PROTOCOL_PARITY.md)、[产品级 Host](docs/HOSTS.md)。

## 架构

```text
浏览器
  | 同源 HTTP + SSE
  | MCP App Host bridge
  v
Official Codex App Server Web
  | 官方 JSON/TS schema gate
  | 有界 Dynamic Tool process host
  | stdio JSONL
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

原生界面包括历史/read/resume、官方 `thread/turns/list` 分页与懒加载、侧边栏“历史完整会话”模式、完整历史关键词筛选、实时 Turn/Item、流式 delta、模型与 reasoning、官方 Turn 处理时长、interrupt、命令/文件/权限审批、用户输入、MCP elicitation、断线权威重同步，以及 MCP App 渲染。执行项会像 Codex 一样收进默认折叠的“工作过程”，主回答保持在对话主线上；官方返回非空计划时，计划卡固定在输入框上方，桌面端悬停/聚焦查看步骤，触屏端点击展开；活动 Turn 中继续输入会走官方 `turn/steer` 调整方向，手动上下文整理走官方 `thread/compact/start`，并显示压缩动画。运行中标题、停止按钮、调整方向和上下文仪表均由真实官方 Turn/usage 事件驱动，空闲时不伪造运行状态。其余不常用官方方法仍可在 **官方接口** Drawer 中按当前官方 schema 直接调用。

共享历史遵循单写入者边界：选择会话和重连恢复只使用官方 `thread/read` 与分页读取，不自动 `thread/resume`；只有明确发送或管理操作时才尝试写入。若桌面官方客户端正在占用会话，网页保持只读，任务结束后通过官方状态探测恢复。侧栏提供默认开启的“网页写入”和“桌面占用保护”开关；后者只控制网页安全协调，官方协议不提供直接撤销桌面 ChatGPT 写入权限的接口。会话菜单使用官方 `thread/name/set`、`thread/archive`、`thread/unarchive`、`thread/delete`，不直接改历史文件。

当前固定的 Codex 官方协议提供 `thread/turns/list`、`thread/items/list` 分页和 `thread/searchOccurrences` 官方全文检索。完整历史模式仍然按页运行：先立即显示最近一页，历史控件吸附在顶部，只有用户明确加载更早内容或搜索命中更早会话段时才继续读取对应分页。搜索以官方 occurrence 索引为主，并补充已经渲染的工作过程文本，不伪造 ChatGPT 私有接口。每一页单独请求，遇到大页还会自动降为更小分页重试，整段会话不会被拼成一条 128 MiB JSONL。普通会话启动时只读最近一页，旧内容按需加载，不会隐式进入完整历史模式。分页消除了“整段会话启动读取”的聚合阈值；但单个异常巨大的官方 Turn 仍可能触发传输安全闸门，需要先由官方压缩上下文。

每次网关启动都会生成运行代际标识，并同时通过 `/api/meta`、SSE `connected` 帧提供。浏览器在 SSE 断线重连、页面重新获得焦点或检测到代际变化时，只用官方权威历史重新读取页面，不会因为恢复页面而抢占桌面会话；`thread/resume` 仅在明确的网页写入动作中调用。若官方返回 active-writer 冲突，网关返回明确的只读状态，网页不会把它伪装成 502。Linux 安装器把官方 App Server 放在独立的 `codex-official-app-server.service` 中，网关重启不会终止官方 Turn；断线期间没有缓存的增量不会被伪造重放。若官方 App Server 自身被停止、崩溃或机器关机，操作系统仍会终止正在生成的 Turn；官方协议没有把已被终止的模型生成凭空续跑的接口。

`CWEB_CODEX_TRANSPORT=websocket` 与 `CWEB_CODEX_SERVER_URL` 控制持久官方传输。WebSocket 端点只接受 loopback `ws(s)` 地址，官方服务单元不接收 Web 会话令牌或其他 `CWEB_*` 配置。`npm start` 未安装独立服务时仍默认为 stdio；要获得重启后继续接管的行为，应使用 `scripts/install-linux.sh` 安装的双服务部署。

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
| `CWEB_EXPERIMENTAL` | `1` | 开启官方 experimental API（分页历史依赖此官方握手）；设为 `0` 可强制仅稳定协议回退 |
| `CWEB_MCP_APPS` | `1` | 声明并渲染稳定 MCP Apps 扩展 |
| `CWEB_MCP_APP_PERMISSIONS` | 空 | 可选权限 allow-list；最终仍受浏览器 secure-context / Permissions Policy 约束 |
| `CWEB_DYNAMIC_TOOLS_FILE` | 空 | Dynamic Tool Host v1 JSON；要求 `CWEB_EXPERIMENTAL=1` |
| `CWEB_NOTIFICATION_OPT_OUT` | `turn/diff/updated`, `turn/moderationMetadata` | 额外要抑制的 notification；聚合 Diff 和 moderation bookkeeping 始终不进入对话时间线 |
| `CWEB_STATE_DIR` | XDG state | 项目 schema/cache 与网页写入控制状态；官方会话仍由 Codex Runtime 管理 |
| `CWEB_SCHEMA_REFRESH` | `1` | 启动时重新生成官方协议 |

MCP Apps 和 Dynamic Tool 的详细契约见 [docs/HOSTS.md](docs/HOSTS.md)。

## Linux user service

```bash
./scripts/install-linux.sh
```

安装器只写项目自己的 XDG config/state 与两个 systemd user service；会复用现有官方 Codex 可执行文件启动独立 App Server，但不会安装、升级、登录或直接修改 Codex。

## 封存检查

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
npm run seal:core
npm run seal
```

CI 包括：完整测试/静态检查、Pinned Stable 官方协议封存、Pinned Experimental 官方协议封存、Latest Stable+Experimental advisory canary。

`npm run seal` 还会在目标主机启动真实官方 App Server 并调用官方导出 RPC。真正带用户账号的模型 turn 仍需要目标机存在有效官方登录凭据；测试不会把没有执行过的真实账号 E2E 冒充成已验证。

## 与 OpenAI 的关系

这是基于 OpenAI 官方 Codex 接口的独立客户端，不代表 OpenAI 官方背书；项目刻意不调用 ChatGPT 私有 backend。
