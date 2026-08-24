# Official Codex App Server Web

[English](README.md)

一个中英文双语、自托管的 **OpenAI 官方 Codex App Server Web 客户端**。它的定位是“官方协议客户端”，不是重新造 Codex：不解析终端输出、不调用 ChatGPT 私有后端、不直接读取 Codex 登录凭据、不修改 Codex 二进制，也不接管 Codex 配置。

## 封存契约

- **只接官方 App Server。** 生产 transport 固定为本地 `stdio` JSONL。
- **Stable 协议覆盖不是手工维护。** 启动时由本机官方 `codex` 同时导出 JSON Schema 和 TypeScript 协议；两套导出的 request / notification method 集合必须完全一致，否则直接 fail closed。
- **Stable wire/API 方法 100% 覆盖。** `ClientRequest` / `ClientNotification` 导出的每个 stable method，要么由网关自动管理生命周期（`initialize` / `initialized`），要么通过 schema gate 的“官方接口”界面可调用。Server Request / Notification 也必须先匹配官方导出才会进入浏览器。
- **核心使用流程原生化。** Thread、历史读取/恢复、Turn、实时输出、中断、审批、模型和该模型真正支持的 reasoning effort 都是直接 UI；少见 stable 接口仍由官方 schema 表单兜底。
- **Experimental 必须显式开启** `CWEB_EXPERIMENTAL=1`，并且不属于封存兼容承诺。
- **Never bypass Codex。** 本项目不直接读写 Codex 的 auth/config/session。用户主动调用官方状态修改 RPC 时，由 Codex 自己完成修改。
- **进程与密钥隔离。** 服务只管理自己启动的 App Server 子进程；所有 `CWEB_*` Web 密钥都会从 Codex 子进程环境剥离。产品中没有 `pkill`、`killall`、Codex 安装器或升级器。
- **资源有界。** RPC 并发、stdin 缓冲、JSONL 单记录、浏览器事件和慢 SSE 客户端缓存都有硬上限。App Server 意外退出时会清除过期审批，并使用有界指数退避重新启动。
- **断线正确恢复。** 浏览器重连后重新读取权威状态，不会自动重放结果不确定的写操作。
- **项目自有状态不进入 `CODEX_HOME`**，全部走 XDG config/state。
- **中文 / English 同等级支持。**

精确保证和不保证的边界见 [封存契约](docs/ARCHIVE_CONTRACT.md)。

## 架构

```text
浏览器
  | 同源 HTTP + SSE
  v
Official Codex App Server Web
  | 双向官方 schema gate
  | stdio JSONL
  v
codex app-server
  v
官方 Codex Runtime / 账号 / 工作区
```

启动时由当前安装的官方 Codex 自己生成两套导出：

```bash
codex app-server generate-json-schema --out <state-dir>/schema-stable
codex app-server generate-ts          --out <state-dir>/schema-stable
```

缓存会记录**精确 Codex 版本 + 协议 digest**。如果关闭自动刷新后版本或 digest 不一致，服务拒绝启动，而不是偷偷使用过期 schema。

## Web 界面

默认界面保持简单：

- Thread 列表与历史；
- 历史 Thread 继续发送前自动走官方 `thread/resume`；
- 对话时间线与实时通知；
- 模型选择，并且 reasoning effort 只显示该模型官方声明支持的组合；
- 发送、中断、命令/文件/权限审批；
- 手机端导航和中英文切换；
- 断线重连与权威状态重同步；
- 完整 **官方接口** 面板覆盖其余 stable protocol。

`initialize` / `initialized` 这类连接握手由网关自动完成，在接口页里会标为 gateway-managed，不允许浏览器重复握手破坏连接。

## 环境要求

- Linux 或官方 Codex CLI 支持的系统；
- Node.js 22.12+；
- 可工作的官方 `codex` CLI；
- 真正使用时，先通过官方正常流程完成 Codex 登录。

**运行时 npm 依赖为 0。**

## 本机运行

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

打开 `http://127.0.0.1:4173`，输入 token。

仅开发时：

```bash
npm run dev
```

开发模式关闭应用层认证，因此仍强制 loopback。

## Linux user service

```bash
./scripts/install-linux.sh
```

安装脚本会解析并记录当前**精确 `node` 与 `codex` 路径**，只写项目自己的：

- `~/.config/codex-app-server-web/env`
- `~/.config/systemd/user/codex-app-server-web.service`
- `~/.local/state/codex-app-server-web/`

service 使用 `UMask=0077`、`KillMode=control-group`、有界停止、默认强制认证，并且遇到配置/schema 致命错误不会无限重启。它不会修改官方 Codex 安装、配置或其他 Codex service。

远程访问建议保持 `127.0.0.1`，再放到 Tailscale、带认证 HTTPS 反代或 SSH tunnel 后面；不要把原始 HTTP 端口直接映射公网。

## 主要配置

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `CWEB_HOST` | `127.0.0.1` | HTTP 监听 |
| `CWEB_PORT` | `4173` | HTTP 端口 |
| `CWEB_CODEX_BIN` | `codex` | 官方 Codex 可执行文件 |
| `CWEB_WORKSPACE` | 当前目录 | 初始工作目录 |
| `CWEB_REQUIRE_AUTH` | `1` | 默认 fail-closed 认证 |
| `CWEB_TOKEN` | 空 | 开启认证时必须设置 |
| `CWEB_PUBLIC_ORIGIN` | 空 | 反代部署时唯一可信 Origin |
| `CWEB_EXPERIMENTAL` | `0` | 启用官方 experimental API |
| `CWEB_STATE_DIR` | XDG state | 项目自己的 schema/cache |
| `CWEB_SCHEMA_REFRESH` | `1` | 启动时重新生成官方导出 |
| `CWEB_RPC_TIMEOUT_MS` | `600000` | RPC 超时上限 |
| `CWEB_MAX_PENDING_RPC` | `64` | 最大并发 pending RPC |
| `CWEB_MAX_STDIN_BUFFER` | `4194304` | App Server stdin 排队上限 |
| `CWEB_MAX_JSONL_LINE` | `33554432` | App Server 单条 JSONL 上限 |
| `CWEB_EVENT_MAX_BYTES` | `16777216` | 浏览器事件大小上限 |
| `CWEB_SSE_MAX_BUFFER` | `2097152` | 慢 SSE 客户端缓存上限 |

健康探针：

```text
GET /healthz   Web 进程健康
GET /readyz    官方 App Server 就绪
```

## 可复现检查与封存

CI 有一个**固定已验证 Codex 版本**作为必过基线，同时另跑一个 `@openai/codex@latest` advisory job 监控未来兼容性。GitHub Actions 全部使用精确 commit SHA。

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
npm run seal:core
npm run seal
```

- `manifest:verify`：校验仓库源码 manifest；
- `seal:core`：校验源码不变量 + 当前 Codex 的 JSON/TS 官方协议导出完全一致；
- `seal`：在目标机器上真实启动自己的官方 App Server，并通过官方 RPC 验证 `account/read`、`model/list`、`thread/list`，以及当前版本存在时的 `thread/loaded/list`。全部通过后才输出 `ARCHIVE_READY`。

更多见 [Production Seal](docs/PRODUCTION_SEAL.md)、[Architecture](ARCHITECTURE.md)、[Security](SECURITY.md)、[Upstream validation](docs/UPSTREAM_VALIDATION.md)。

## 与其他 Codex 客户端共存

本项目只是官方 Codex 接口的独立 Web 客户端，并非 OpenAI 官方产品，也不受 OpenAI 背书。它只管理自己启动的 App Server，因此可以与其他客户端并存。

如果多个客户端故意同时修改同一 workspace，或同时调用官方全局配置写接口，仍然存在正常的共享状态/文件并发语义。对同时运行其他 Codex 客户端的封存部署，按 Production Seal 里的 non-interference 流程额外验证一次。
