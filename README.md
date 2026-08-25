# Official Codex App Server Web

[简体中文](README.zh-CN.md)

A self-hosted Web host for the **official OpenAI Codex App Server protocol**. The browser never replaces the Codex runtime: the gateway launches the official `codex app-server`, derives the wire contract from that binary, and presents native Thread/Turn/Item UX plus a schema-driven surface for the remaining official methods.

## v0.4.0 archive boundary

- **Official App Server only:** production transport is local JSONL over `codex app-server --listen stdio://`.
- **No hand-written ClientRequest allow-list:** the installed Codex exports JSON Schema and TypeScript; every JSON wire method must be present in the TypeScript export or startup fails closed.
- **Stable client method coverage:** `initialize`/`initialized` are gateway-managed; every other exported ClientRequest/ClientNotification is schema-gated and invocable from the Official APIs surface.
- **Native server-request handling:** approvals, user input, MCP elicitation, permissions, Dynamic Tools and the experimental external clock request have explicit host dispositions. Platform-only auth-token refresh and attestation remain outside the browser trust boundary.
- **MCP Apps Host:** advertises `io.modelcontextprotocol/ui` with `text/html;profile=mcp-app` and implements the stable `2026-01-26` host protocol using the mandatory double-iframe Web sandbox pattern.
- **Dynamic Tool Host:** optional configured local process handlers are injected through official experimental `thread/start.dynamicTools` and are executed without a shell, with strict environment, time, request and output bounds. Unconfigured dynamic calls retain the manual Web fallback.
- **Stable + experimental protocol seal:** CI regenerates both protocol modes and fails the pinned archive baseline if a ThreadItem or ServerRequest has no declared disposition.
- **Zero runtime npm dependencies.** Node.js 22.12+ is required.
- **No private ChatGPT backend, no Codex credential scraping, no direct `auth.json`/`config.toml` mutation, no Codex installer/upgrader, no process-wide kill.**

The archive baseline is pinned to official `@openai/codex` **0.149.1**. If the goal is “seal it and do not maintain it”, keep that validated Codex version. The scheduled latest-version CI job is deliberately advisory: a future upstream protocol change can be detected, but no static third-party project can promise compatibility with every future unreleased Codex version without maintenance.

See [Archive Contract](docs/ARCHIVE_CONTRACT.md), [Protocol Parity](docs/PROTOCOL_PARITY.md), and [Product Hosts](docs/HOSTS.md).

## Architecture

```text
Browser
  | same-origin HTTP + SSE
  | MCP App Host bridge
  v
Official Codex App Server Web
  | official JSON/TS schema gate
  | bounded Dynamic Tool process host
  | JSONL over stdio
  v
codex app-server
  | Thread / Turn / Item / MCP / approvals / models / account
  v
Official Codex runtime

MCP App rendering:
Host page
  -> outer Sandbox Proxy (opaque data: origin; allow-scripts + allow-same-origin)
     -> inner untrusted App iframe (allow-scripts + allow-same-origin + allow-forms; still isolated from Host by the outer cross-origin proxy)
```

## Normal Web UX

The first-class UI includes thread history/read/resume, live turns and items, streaming deltas, model/reasoning controls, official image attachments (`turn/start` `image` inputs), interrupt, command/file/permission approvals, user-input and MCP elicitation forms, reconnect/resync, and MCP App rendering. The **Capabilities** summary reads the official MCP, Skills, Plugin, and installed App inventories; less common official methods remain callable through the generated **Official APIs** drawer with human labels and collapsed technical payloads.

## Requirements

- OS supported by the official Codex CLI
- Node.js 22.12+
- official `codex` installed and usable
- normal official Codex sign-in for account-backed use

## Run

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

Open `http://127.0.0.1:4173`.

For remote use, keep the service behind Tailscale, SSH tunneling, or an authenticated HTTPS reverse proxy. Do not expose the raw unauthenticated HTTP port.

## Product-host configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CWEB_HOST` | `127.0.0.1` | HTTP bind host |
| `CWEB_PORT` | `4173` | HTTP port |
| `CWEB_CODEX_BIN` | `codex` | official Codex executable |
| `CWEB_WORKSPACE` | process cwd | initial workspace |
| `CWEB_REQUIRE_AUTH` | `1` | Web authentication |
| `CWEB_TOKEN` | empty | required when auth is enabled |
| `CWEB_PUBLIC_ORIGIN` | empty | exact trusted public origin |
| `CWEB_ACCESS_PROFILE` | `full` | `read`, `coding`, `admin`, or `full` |
| `CWEB_EXPERIMENTAL` | `0` | enable official experimental API surface |
| `CWEB_MCP_APPS` | `1` | advertise/render the stable MCP Apps extension |
| `CWEB_MCP_APP_PERMISSIONS` | empty | optional requested-permission allow-list; browser secure-context/Permissions Policy rules still apply |
| `CWEB_DYNAMIC_TOOLS_FILE` | empty | v1 Dynamic Tool Host JSON configuration; requires `CWEB_EXPERIMENTAL=1` |
| `CWEB_NOTIFICATION_OPT_OUT` | empty | exact App Server notification methods to suppress |
| `CWEB_STATE_DIR` | XDG state path | project schema/cache state |
| `CWEB_SCHEMA_REFRESH` | `1` | regenerate official protocol exports at startup |

Detailed MCP App and Dynamic Tool contracts are in [docs/HOSTS.md](docs/HOSTS.md).

## Linux user service

```bash
./scripts/install-linux.sh
```

The installer writes only project-owned XDG config/state plus a systemd user service. It does not install, upgrade, authenticate, or mutate Codex itself. When the invoking shell has explicit proxy variables, it preserves them in the mode-`600` service environment so a user service can reach the official upstream on networks that require a local proxy.

## Reproducible seal

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
npm run seal:core
npm run seal
```

CI includes:

- unit/integration/static checks;
- pinned stable official protocol seal;
- pinned experimental official protocol seal;
- latest official stable+experimental advisory seal.

`npm run seal` additionally launches the real official App Server on the target host and verifies exported official RPCs. A real authenticated model turn still requires valid user credentials on that target machine; tests never fake that claim.

## Relationship to OpenAI

This is an independent client for an official OpenAI Codex interface; it is not affiliated with or endorsed by OpenAI. It intentionally does not call private ChatGPT backend endpoints.
