# Codex App Server Web

[English](README.md)

一个中英文双语、自托管的 **OpenAI 官方 Codex App Server Web 客户端**。

它不重新实现 Agent Runtime，不解析终端输出，不调用 ChatGPT 私有接口，不直接读取 Codex 登录凭据，不修改 Codex 二进制，也不接管 Codex 配置。浏览器产生的所有 Codex 操作，都必须先存在于本机官方 `codex app-server` 生成的 JSON Schema 中。

## 核心契约

- 只使用官方 `codex app-server`。
- 生产 transport 固定为本地 `stdio` JSONL。
- Stable 官方接口由 schema 自动覆盖：`ClientRequest.json` / `ClientNotification.json` 里新增的 method 会自动进入允许列表。
- Server Request / Notification 同样从官方 schema 自动发现并转发到浏览器。
- Experimental 只有显式设置 `CWEB_EXPERIMENTAL=1` 才开启，不属于封存兼容承诺。
- 本项目不直接读写 Codex 的登录、配置、session 文件。
- 不提供安装、更新、升级 Codex 或全局杀 Codex 进程的能力。
- 自己的状态只进入 XDG config/state 路径，不进入 `CODEX_HOME`。
- 中英文是同等级界面，可以运行时切换。

## 架构

```text
浏览器
  | HTTPS / 同源 HTTP + SSE
  v
Codex App Server Web
  | 官方 schema 白名单 JSON-RPC
  | stdio JSONL
  v
codex app-server
  v
官方 Codex Runtime / 账号 / 工作区
```

启动时网关让当前机器安装的官方 Codex 自己生成 schema：

```bash
codex app-server generate-json-schema --out <state-dir>/schema-stable
```

因此不是“我们声明支持某个 Codex 版本”，而是“当前这个 Codex 公布什么 stable 协议，我们就按它的真实 schema 接入什么”。不在官方 schema 里的 method 会在到达 Codex 之前被拒绝。

## Web 界面

默认界面保持简单：会话列表、聊天时间线、实时事件、审批、发送/停止、中英文切换。另有一个独立的 **官方接口** 抽屉，完整展示 schema 自动发现的接口。

常用能力做原生 UI；少见 stable 方法使用 schema-backed JSON 表单。因此即使上游新增 stable API，而专门 UI 还没来得及设计，它仍然可以立即通过完整官方接口层使用。

## 环境要求

- Linux 或官方 Codex CLI 支持的系统。
- Node.js 22.12+。
- 已安装可工作的官方 `codex` CLI。
- 真正使用时应通过官方正常流程登录 Codex。

**运行时 npm 依赖为 0。**

## 本机运行

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

打开 `http://127.0.0.1:4173`，输入访问令牌。

仅开发环境可以：

```bash
npm run dev
```

开发模式关闭应用层认证，因此服务器仍强制只能监听 loopback。

## Linux user service 安装

```bash
./scripts/install-linux.sh
```

安装器只写自己的文件：

- `~/.config/codex-app-server-web/env`
- `~/.config/systemd/user/codex-app-server-web.service`
- `~/.local/state/codex-app-server-web/`

不会修改 Codex 安装、Codex service、`CODEX_HOME`。默认只监听 `127.0.0.1`，建议通过 Tailscale、带认证的 HTTPS 反代或其他可信私网访问，不直接把端口暴露公网。

## Stable / Experimental

封存契约只包含 **Stable 官方接口**。Experimental 可以测试和使用，但上游本来就不保证向后兼容，因此不应成为核心功能必须依赖的能力。

## 检查和封存

```bash
npm test
npm run check
npm run seal:core
npm run seal
```

`seal:core` 验证源码不变量和当前官方 schema 兼容性；`seal` 还会启动官方 App Server，并通过官方 RPC 检查登录账号、模型和会话读取，最后才输出：

```text
ARCHIVE_READY
```

详见 [生产封存](docs/PRODUCTION_SEAL.md)、[架构](ARCHITECTURE.md)、[安全模型](SECURITY.md)。

## 与其他 Codex 项目并存

项目只管理自己 `spawn` 出来的 App Server 子进程，不使用 `pkill` / `killall`，也不会控制其他 Codex/App Server 进程。因此可以和其他 Codex 客户端并存。

需要注意：如果两个官方 Codex 客户端同时修改同一个 workspace，或者用户主动从 Web 调用官方 `config/*write` 一类接口，仍然存在正常的共享状态/并发语义。这是官方 Codex 与文件系统本身的行为，不是本项目绕过 Codex 偷偷改状态。
