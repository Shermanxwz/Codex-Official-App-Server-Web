# Official Codex App Server Web

[English](README.md)

一个中英文双语、自托管的 **OpenAI 官方 Codex App Server Web 客户端**。它是官方 App Server 协议的 Web Client，不重新实现 Codex Runtime。

## 封存契约

- 生产只使用官方 `codex app-server --listen stdio://`，浏览器不直接连接 Codex。
- Stable wire 方法以当前 Codex 导出的 JSON Schema 为权威集合；每个 JSON wire method 都必须同时被官方 TypeScript 导出覆盖，否则启动 fail closed。
- TypeScript-only 的 legacy/type 导出只记录为诊断信息，不会被冒充成当前可调用 wire method。
- `ClientRequest` / `ClientNotification` 的 stable 方法全部覆盖：`initialize` / `initialized` 由网关管理，其余方法通过原生 UI 或“官方接口”schema 表单调用。
- Server Request / Notification 同样经过官方 schema gate 后才进入浏览器。
- Experimental 只有显式设置 `CWEB_EXPERIMENTAL=1` 才开启，不属于封存兼容承诺。
- 本项目不直接读写 Codex 的 `auth.json`、`config.toml` 或 session；官方状态修改 RPC 由 Codex 自己执行。
- 所有 `CWEB_*` 变量在启动任何 Codex 子进程前全部剥离，Web 登录密钥不会进入 Codex/Agent 命令环境。
- 只管理自己启动的 App Server 子进程，不使用 `pkill` / `killall`，也不安装或升级 Codex。
- RPC、stdin、JSONL、HTTP、SSE、Session、限流状态都有硬上限；App Server 意外退出会清理过期审批并有界重启。
- 浏览器断线后重新读取权威状态，不自动重放结果不确定的写操作。
- 项目自有状态只写 XDG config/state，不进入 `CODEX_HOME`。
- 中文与 English 为同等级界面。

精确边界见 [封存契约](docs/ARCHIVE_CONTRACT.md)。

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

启动时由当前安装的官方 Codex 生成：

```bash
codex app-server generate-json-schema --out <state-dir>/schema-stable
codex app-server generate-ts          --out <state-dir>/schema-stable
```

缓存记录精确 Codex 版本、Stable/Experimental 模式和导出 SHA-256 digest。关闭自动刷新后，版本或 digest 不匹配会拒绝启动。

## Web 界面

默认界面保持简单：Thread 列表、历史读取/恢复、对话时间线、实时输出、模型与该模型支持的 reasoning effort、发送/中断、命令/文件/权限审批、手机端导航、中英文切换、断线重同步。

其余 Stable 方法统一进入 **官方接口** 面板。`initialize` / `initialized` 为 gateway-managed，不允许浏览器重复握手。

## 环境要求

- 官方 Codex CLI 支持的 Linux/OS
- Node.js 22.12+
- 已安装并可运行官方 `codex`
- 实际使用前通过官方流程登录 Codex

运行时 npm 依赖为 **0**。

## 本机运行

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

打开 `http://127.0.0.1:4173`。

## Linux user service

```bash
./scripts/install-linux.sh
```

安装器只写项目自己的：

- `~/.config/codex-app-server-web/env`
- `~/.config/systemd/user/codex-app-server-web.service`
- `~/.local/state/codex-app-server-web/`

默认 `127.0.0.1`、认证开启、`UMask=0077`、`KillMode=control-group`。远程访问建议放在 Tailscale、可信 HTTPS 反代或 SSH tunnel 后面，不要直接暴露原始 HTTP 端口。

## 封存检查

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
npm run seal:core
npm run seal
```

CI 必过基线固定到已验证官方 Codex 版本，同时另跑 `@openai/codex@latest` advisory job 监控未来协议变化。GitHub Actions 全部固定精确 commit SHA。

`seal:core` 验证源码不变量和当前 Codex 的官方 JSON/TS 导出关系；`seal` 还会在目标机器启动自己的真实官方 App Server，并通过官方 RPC 验证账户、模型和 Thread 读取。全部通过后才输出：

```text
ARCHIVE_READY
```

更多见 [Production Seal](docs/PRODUCTION_SEAL.md)、[Architecture](ARCHITECTURE.md)、[Security](SECURITY.md)、[Upstream validation](docs/UPSTREAM_VALIDATION.md)。

## 与其他 Codex 客户端共存

本项目只管理自己启动的 App Server，可以与其他 Codex 客户端并存。多个客户端如果主动同时修改同一 workspace 或调用官方全局配置写接口，仍然存在正常的共享状态/文件并发语义；这不属于 Web 网关偷偷修改 Codex。