# Official Codex App Server Web

[简体中文](README.zh-CN.md)

A self-hosted Web host for the **official OpenAI Codex App Server protocol**. The browser never replaces the Codex runtime: the gateway launches the official `codex app-server`, derives the wire contract from that binary, and presents native Thread/Turn/Item UX plus a schema-driven surface for the remaining official methods.

## v0.4.0 archive boundary

- **Official App Server only:** the Linux installer runs the official `codex app-server --listen ws://127.0.0.1:43999` under a separate user service and connects the Web gateway through the official WebSocket transport; portable manual startup keeps stdio compatibility.
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

The first-class UI includes thread history/read/resume, official paginated history (`thread/turns/list`) with a recent-page lazy view, an explicit full-history mode in the sidebar, full-history keyword filtering over content loaded by those official pages, live turns and items, streaming deltas, model/reasoning controls, official image attachments (`turn/start` `image` inputs), interrupt, live direction changes through official `turn/steer`, command/file/permission approvals, user-input and MCP elicitation forms, reconnect/resync, context-compaction animation, official turn duration, and MCP App rendering. Execution items are grouped into a compact, collapsed work-process track so the assistant answer stays primary. An official non-empty plan is pinned above the composer as a compact progress card: desktop hover/focus previews steps and touch devices open it by tap. The running header, stop action, steer affordance, and context meter are driven by real official Turn/usage events; idle pages do not fabricate a running state. The **Capabilities** summary reads the official MCP, Skills, Plugin, and installed App inventories; less common official methods remain callable through the generated **Official APIs** drawer with human labels and collapsed technical payloads.

Shared history follows a single-writer boundary: selecting a thread and reconnect recovery use only official `thread/read` and paginated reads, never an implicit `thread/resume`; an explicit Web write is the only path that attempts to resume ownership. If the desktop official client owns a thread, the Web view stays read-only and returns to writable after authoritative status shows that the turn has finished. The sidebar provides default-on **Web writes** and **Desktop ownership guard** switches. The latter coordinates Web safety only—the official protocol has no operation that revokes the desktop ChatGPT client’s write permission. Thread actions use official `thread/name/set`, `thread/archive`, `thread/unarchive`, and `thread/delete`; the gateway never edits history files directly.

The pinned Codex baseline exposes official pagination and `thread/searchOccurrences`. Quick view is capped at the 12 most recent turns: it still uses one official page to bound startup, but does not expose an older-page control. Full-history mode is the only human-facing page-by-page flow: it shows the recent page immediately, keeps the older-page control sticky at the top, and loads only the pages needed by an explicit load action or full-history search. Search uses the official occurrence index and also checks the already-rendered work-process text, so the UI does not invent a private ChatGPT endpoint. Each history page is requested separately, with a smaller-page retry if a large page crosses the transport guard, so the aggregate conversation is not sent as one 128 MiB JSONL line. Pagination removes the aggregate-session startup limit; a single unusually large official turn can still hit the transport guard and must be compacted upstream.

Each gateway boot has a runtime generation identity exposed by `/api/meta` and the SSE `connected` frame. After an SSE reconnect, window focus, or detected generation change, the browser reloads authoritative official history without claiming a desktop-owned thread; `thread/resume` is called only by an explicit Web write. An active-writer response becomes an explicit read-only state rather than a misleading 502. The Linux installer puts the official App Server in a separate `codex-official-app-server.service`, so restarting the Web gateway does not terminate the official Turn; reconnect recovery never invents replay for deltas missed while disconnected. If the official App Server itself is stopped, crashes, or the machine shuts down, the operating system terminates any Turn being generated; the official protocol cannot resurrect a model generation that has been killed.

`CWEB_CODEX_TRANSPORT=websocket` and `CWEB_CODEX_SERVER_URL` select the persistent official transport. The endpoint is restricted to loopback `ws(s)` URLs, and the official service receives neither the Web session token nor other `CWEB_*` settings. `npm start` defaults to stdio when no separate service is installed; use `scripts/install-linux.sh` for the restart-safe two-service deployment.

The gateway does not copy conversation history, model output, or runtime logs into the project directory. Official Codex Runtime owns persistent conversation data. The gateway only owns its official schema cache and automatically removes stale `.tmp`/`.bak` schema-swap artifacts that it created after an interrupted startup; `scripts/prune-state.mjs` runs the same bounded cleanup manually. It never deletes the official `~/.codex` conversation history automatically.

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
| `CWEB_CODEX_TRANSPORT` | `stdio` | `stdio` or `websocket`; the Linux installer writes `websocket` |
| `CWEB_CODEX_SERVER_URL` | `ws://127.0.0.1:43999` | loopback WebSocket endpoint of the separate official App Server |
| `CWEB_WORKSPACE` | process cwd | initial workspace |
| `CWEB_REQUIRE_AUTH` | `1` | Web authentication |
| `CWEB_TOKEN` | empty | required when auth is enabled |
| `CWEB_PUBLIC_ORIGIN` | empty | exact trusted public origin |
| `CWEB_ACCESS_PROFILE` | `full` | `read`, `coding`, `admin`, or `full` |
| `CWEB_EXPERIMENTAL` | `1` | enable the official experimental surface used for paginated history; set `0` only to force stable-only fallback |
| `CWEB_MCP_APPS` | `1` | advertise/render the stable MCP Apps extension |
| `CWEB_MCP_APP_PERMISSIONS` | empty | optional requested-permission allow-list; browser secure-context/Permissions Policy rules still apply |
| `CWEB_DYNAMIC_TOOLS_FILE` | empty | v1 Dynamic Tool Host JSON configuration; requires `CWEB_EXPERIMENTAL=1` |
| `CWEB_NOTIFICATION_OPT_OUT` | `turn/diff/updated`, `turn/moderationMetadata` | additional App Server notification methods to suppress; transport diffs and moderation bookkeeping are always hidden from the conversation timeline |
| `CWEB_STATE_DIR` | XDG state path | project schema/cache and Web write-control state; official threads remain owned by Codex Runtime |
| `CWEB_SCHEMA_REFRESH` | `1` | regenerate official protocol exports at startup |

Detailed MCP App and Dynamic Tool contracts are in [docs/HOSTS.md](docs/HOSTS.md).

## Linux user service

```bash
./scripts/install-linux.sh
```

The installer writes only project-owned XDG config/state plus two systemd user services. It reuses the existing official Codex executable for the separate App Server but does not install, upgrade, authenticate, or mutate Codex itself. When the invoking shell has explicit proxy variables, it preserves them in mode-`600` service environments so the official runtime can reach its upstream on networks that require a local proxy.

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
