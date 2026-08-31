# Official Codex App Server Web

[简体中文](README.zh-CN.md)

A self-hosted Web host for the **official OpenAI Codex App Server protocol**. The browser never replaces the Codex runtime: the gateway launches the official `codex app-server`, derives the wire contract from that binary, and presents native Thread/Turn/Item UX plus a schema-driven surface for the remaining official methods.

## v0.4.0 archive boundary

- **Official App Server only:** the Linux installer runs the official `codex app-server --listen ws://127.0.0.1:43999` under a separate user service and connects the Web gateway through the official WebSocket transport; portable manual startup keeps stdio compatibility.
- **No hand-written ClientRequest allow-list:** the installed Codex exports JSON Schema and TypeScript; every JSON wire method must be present in the TypeScript export or startup fails closed.
- **Stable client method coverage:** `initialize`/`initialized` are gateway-managed; every other exported ClientRequest/ClientNotification is schema-gated and invocable from the Official APIs surface.
- **Native server-request handling:** approvals, user input, MCP elicitation, permissions, Dynamic Tools and the experimental external clock request have explicit host dispositions. Platform-only auth-token refresh and attestation remain outside the browser trust boundary.
- **MCP Apps Host:** advertises `io.modelcontextprotocol/ui` with `text/html;profile=mcp-app` and implements the stable `2026-01-26` host protocol using the mandatory double-iframe Web sandbox pattern.
- **Dynamic Tool Host:** optional configured local process handlers are injected through official experimental `thread/start.dynamicTools` and are executed without a shell, with strict environment, time, request and output bounds. Unconfigured or unmatched dynamic calls receive the official `-32601` response and never become fake approval UI.
- **Stable + experimental protocol seal:** CI regenerates both protocol modes and fails the pinned archive baseline if a ThreadItem or ServerRequest has no declared disposition. Every schema-admitted ServerNotification is retained first in a bounded Official Events log, including notifications that do not belong in the conversation timeline.
- **Zero runtime npm dependencies.** Node.js 22.12+ is required.
- **No private ChatGPT backend, no Codex credential scraping, no direct `auth.json`/`config.toml` mutation, no Codex installer/upgrader, no process-wide kill.**

The archive baseline is pinned to official `@openai/codex` **0.150.1** and was validated with a real authenticated model Turn plus persisted `thread/turns/list` and `thread/items/list` reads. If the goal is “seal it and do not maintain it”, keep that exact validated Codex version. The scheduled latest-version CI job is deliberately advisory: a future upstream protocol change can be detected, but no static third-party project can promise compatibility with every future unreleased Codex version without maintenance.

See [Archive Contract](docs/ARCHIVE_CONTRACT.md), [Protocol Parity](docs/PROTOCOL_PARITY.md), and [Product Hosts](docs/HOSTS.md).

## Feature map

| Area | Implemented behavior |
| --- | --- |
| Official protocol | Runtime-generated JSON Schema + TypeScript contract, Stable/Experimental negotiation, fail-closed method gate, all current official ThreadItem renderers, a bounded observer for every official ServerNotification, and an Official APIs drawer for less-common exported methods. |
| Conversation UX | Thread list, new/read/list/resume flows, official rename/archive/unarchive/delete actions, model and reasoning controls, official image input, interrupt, live steer, context compaction, and official turn duration. |
| Unattended execution | An explicit sidebar switch wires the official `approvalPolicy:'never'` and `danger-full-access` combination into new, resumed, configured, Turn, and command-execution paths; turning it off restores the official default approval behavior. |
| Fast history | Quick view shows the 10 newest Turns. It first reads a lightweight official `itemsView: notLoaded` page, then automatically hydrates all 10 Turns—including conversation and work-process items—through official `thread/items/list` calls with bounded concurrency. If an advertised optional history method is rejected at runtime, the client trips a one-way compatibility fallback to stable `thread/read` and hides the unavailable paging controls. |
| Complete history | Full-history mode follows official cursors page by page. Older Turns and their work process are hydrated per Turn only when visible or explicitly requested; the quick view never exposes an older-page control. |
| Search | Full-history keyword search uses official `thread/searchOccurrences` pages and official snippets, then supplements results with already-rendered work-process text. |
| Live runtime | Per-client SSE queues, data heartbeats, reconnect/resync, official active-state tracking, real-time item/delta updates, live duration, persistent official plan card, terminal reconciliation, and retention of live work process when a Turn becomes final. |
| Reliable delivery | Official `clientUserMessageId`, optimistic rendering, immediate composer clearing, persisted “confirming” state, bounded reconciliation, and a ten-minute deduplication result cache prevent lost-response retries from creating duplicate Turns. |
| Shared history | One persisted **Web writes** switch. Other official clients remain readable; only the official App Server decides whether a concurrent write is accepted. There is no extra desktop-ownership guard. |
| MCP Apps | Stable MCP Apps `2026-01-26` host, official resource/tool proxying, visibility checks, opaque-origin double-iframe sandbox, CSP/permission enforcement, and bounded JSON-RPC bridge. |
| Dynamic Tools | Optional experimental, operator-configured process handlers using official `thread/start.dynamicTools`, `shell:false`, stdin JSON, strict bounds, and official `-32601` for unmatched tools. |
| Security and operations | Authentication by default, exact-origin protection for writes, access profiles, bounded resource queues, secret/environment isolation, separate supervised official App Server on Linux, and portable stdio startup. |

The product deliberately does not emulate private ChatGPT endpoints, copy Codex credentials or history files, install/upgrade Codex, or kill unrelated Codex processes. The official App Server remains the authority for protocol behavior, account state, conversation persistence, concurrent writers, and upstream limits.

## Architecture

```text
Browser
  | same-origin HTTP + SSE
  | MCP App Host bridge
  v
Official Codex App Server Web
  | official JSON/TS schema + access-profile gate
  | bounded Dynamic Tool process host
  | official WebSocket (Linux service) / stdio JSONL (portable)
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

New Web-created threads request the official `historyMode:'paginated'` contract whenever the pinned runtime advertises the paging methods. Existing `legacy` threads remain official threads and are read through stable `thread/read(includeTurns:true)`; experimental paging controls are hidden for them.

Explicit quick-view thread selection bypasses stale browser cache and rereads the official recent ten-turn summary page, with a visible quick-view boundary. A fresh SSE connection receives the gateway's bounded active official-plan snapshot; terminal or empty-plan signals clear it.

The first-class UI includes thread history/read/resume, official paginated history (`thread/turns/list`) with a bounded recent page, per-Turn item hydration through `thread/items/list`, an explicit full-history mode in the sidebar, full-history keyword filtering over the official occurrence index (with official snippets), live turns and items, streaming deltas, model/reasoning controls, official image attachments (`turn/start` `image` inputs), interrupt, live direction changes through official `turn/steer`, command/file/permission approvals, user-input and MCP elicitation forms, reconnect/resync, context-compaction animation, official turn duration, and MCP App rendering. Execution items are grouped into a compact, collapsed work-process track so the assistant answer stays primary. An official non-empty plan is pinned above the composer as a compact progress card: desktop hover/focus previews steps and touch devices open it by tap. The running header and work indicator follow official Turn/thread activity events, including the official thread-level active status (which has no `turnId`); stop, steer, context usage, and Web write ownership remain limited to the Web tab that owns the local turn marker. A bounded official read-only reconciliation clears a local Web turn if its terminal notification was missed, and idle pages do not fabricate a running state. The **Capabilities** summary reads official MCP, Skills, and installed App inventories; the under-development official Plugin inventory is queried only when experimental mode is enabled. Less common official methods remain callable through the generated **Official APIs** drawer with human labels and collapsed technical payloads. Message submission carries an official `clientUserMessageId`; if the response is lost after acceptance, the composer clears immediately, enters a persisted “confirming” state, and reconciles against the official paged turn list instead of allowing an accidental duplicate. The gateway also keeps a bounded ten-minute result cache for repeated `turn/start`/`turn/steer` requests with the same thread and official client message id, so a deliberate retry can safely recover a lost response without sending a second upstream request. Browser RPCs have a bounded timeout; disconnected history/config reads release their gateway-side pending slot, while uncertain Turn writes remain deduplicated and reconcilable. History structure is fetched with official `itemsView: notLoaded`, so image-bearing message payloads do not inflate quick/full startup; the quick window automatically hydrates all of its ten recent Turns through the official items endpoint with bounded concurrency, while older full-history pages hydrate per Turn only when visible or explicitly requested. Search results keep lightweight official excerpts. Repeated sidebar/config reads are coalesced before they reach the official transport. Active duration ticks from the official start timestamp, and live work-process items are retained when a terminal Turn replaces its summary representation.

The sidebar **Write controls** panel contains independent **Web writes** and **Unattended** switches. Unattended mode is effective only when Web writes are enabled and the current official schema exposes the required fields; the gateway does not modify `auth.json` or `config.toml`, but adds the official execution policy at the App Server boundary. User-input forms, MCP elicitation, and side-effecting third-party tool confirmations are not ordinary command approvals, so they remain interactive according to the official protocol. Clicking the Codex mark in the upper-left or the home icon in the top-right returns to the home view without deleting official threads.

Shared history follows a single-writer boundary: selecting a thread and reconnect recovery use only official `thread/read` and paginated reads, never an implicit `thread/resume`; an explicit Web write is the only path that attempts to resume ownership. The Web UI does not add a second desktop-ownership guard: official activity is displayed as running, and only an actual active-writer response makes a thread temporarily read-only. The sidebar provides one persisted **Web writes** switch, while the official App Server remains the authority for concurrent writes. Thread actions use official `thread/name/set`, `thread/archive`, `thread/unarchive`, and `thread/delete`; the gateway never edits history files directly.

The pinned Codex baseline exposes official pagination, `thread/items/list`, and `thread/searchOccurrences`. Quick view is capped at the 10 most recent turns: it requests one lightweight official `itemsView: notLoaded` page to bound first paint, then automatically hydrates those ten Turns (conversation messages and work-process items) through `thread/items/list`, newest first with a concurrency cap of two; it does not expose an older-page control. Full-history mode is the only human-facing page-by-page flow: it shows the recent page structure immediately, keeps the page marker and older-page control sticky at the top, and loads only the pages needed by an explicit load action or full-history search. Only older full-history Turns remain viewport/explicit-request lazy. The active Turn is never excluded from the quick hydration path; live SSE items and an optimistic user message are preserved while the official item list catches up. Search uses the official occurrence index, displays its official excerpts, and also checks already-rendered work-process text, so the UI does not invent a private ChatGPT endpoint. Each history page and each Turn item page is requested separately, with a smaller-page retry if a large page crosses the transport guard, so the aggregate conversation is not sent as one 128 MiB JSONL line. Pagination removes the aggregate-session startup limit; a single unusually large official Turn or item can still hit the transport guard and must be compacted upstream.

Each gateway boot has a runtime generation identity exposed by `/api/meta` and the SSE `connected` frame. After an SSE reconnect, window focus, or detected generation change, the browser reloads authoritative official history without attempting to resume ownership; `thread/resume` is called only by an explicit Web write. An active-writer response becomes an explicit read-only state rather than a misleading 502. The Linux installer puts the official App Server in a separate `codex-official-app-server.service`, so restarting the Web gateway does not terminate the official Turn; reconnect recovery never invents replay for deltas missed while disconnected. If the official App Server itself is stopped, crashes, or the machine shuts down, the operating system terminates any Turn being generated; the official protocol cannot resurrect a model generation that has been killed.

The standalone App Server does not automatically inherit the desktop Codex browser session. This project does not bundle, emulate, or register a browser MCP server. External MCP servers must come from the official Codex Runtime configuration; the Web host only forwards the official `mcpServerStatus/list`, `mcpServer/resource/read`, and `mcpServer/tool/call` methods. If no browser-capable server is configured, the capability is absent rather than simulated. Desktop Browser/Computer Use remains a host-provided capability.

Configure an external MCP server with the official Codex CLI (`codex mcp list` / `codex mcp add`); this project never writes the Codex configuration. Restart the official App Server after changing its MCP configuration.

`CWEB_CODEX_TRANSPORT=websocket` and `CWEB_CODEX_SERVER_URL` select the persistent official transport. The endpoint is restricted to loopback `ws(s)` URLs, and the official service receives neither the Web session token nor other `CWEB_*` settings. The current upstream App Server documentation labels WebSocket transport experimental and unsupported for production; use the portable stdio path where that support boundary matters. `npm start` defaults to stdio when no separate service is installed; use `scripts/install-linux.sh` for the restart-safe two-service deployment.

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
| `CWEB_AUTONOMOUS_MODE` | `0` | default for the gateway's unattended switch at startup; it can also be persisted from the Web sidebar |
| `CWEB_EXPERIMENTAL` | `1` | enable the official experimental surface used for paginated history; set `0` to force stable-only fallback. Even when enabled, a runtime rejection of an advertised optional history method automatically switches the current Web process to stable `thread/read` without a retry loop |
| `CWEB_MCP_APPS` | `1` | advertise/render the stable MCP Apps extension |
| `CWEB_MCP_APP_PERMISSIONS` | empty | optional requested-permission allow-list; browser secure-context/Permissions Policy rules still apply |
| `CWEB_DYNAMIC_TOOLS_FILE` | empty | v1 Dynamic Tool Host JSON configuration; requires `CWEB_EXPERIMENTAL=1` |
| `CWEB_NOTIFICATION_OPT_OUT` | empty | explicit App Server notification methods to suppress; by default all official notifications enter the bounded event observer, while transport diffs and moderation bookkeeping stay out of the conversation timeline |
| `CWEB_STATE_DIR` | XDG state path | project schema/cache and Web write-control state; official threads remain owned by Codex Runtime |
| `CWEB_SCHEMA_REFRESH` | `1` | regenerate official protocol exports at startup |

Detailed MCP App and Dynamic Tool contracts are in [docs/HOSTS.md](docs/HOSTS.md).

## Linux user service

```bash
./scripts/install-linux.sh
```

The installer writes only project-owned XDG config/state plus two systemd user services. It reuses the existing official Codex executable for the separate App Server but does not install, upgrade, authenticate, or mutate Codex itself. Explicit proxy values update the mode-`600` service environments, explicitly empty values clear stale settings, and omitted values preserve the last working proxy configuration. The official App Server environment is rebuilt from a proxy-only allow-list and never receives the Web token or another `CWEB_*` setting.

To pin the archive-validated runtime when more than one official Codex executable is installed, pass an explicit absolute path. This updates the existing Web runtime setting while preserving the access token and other operator settings:

```bash
CWEB_PUBLIC_ORIGIN=https://codex.example.com \
CODEX_BIN_OVERRIDE=/absolute/path/to/codex \
./scripts/install-linux.sh
```

`CWEB_PUBLIC_ORIGIN` is the canonical public origin with no trailing slash; providing it makes login cookies `Secure` on HTTPS and pins write-origin checks instead of relying on a forwarded Host header. Without the runtime override, the installer discovers `codex` on `PATH`; it never installs or upgrades Codex.

## Reproducible seal

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

CI includes:

- unit/integration/static checks;
- stable/experimental official interface audit of every browser call site, timeline notification and host disposition;
- pinned stable official protocol seal;
- pinned experimental official protocol seal;
- latest official stable+experimental advisory seal.

`npm run smoke:runtime` launches the exact selected official App Server binary and verifies account/model RPCs plus the paginated-thread lifecycle. Set `CWEB_RUNTIME_SMOKE_MODEL_TURN=1` for the deployment-host proof that also runs a real model Turn, reads its persisted Turn/items, verifies a unique assistant sentinel, and deletes the test thread. `npm run seal` verifies the remaining exported official RPC surface. Tests never fake an authenticated model-Turn claim.

`npm run smoke:gateway` repeats that proof through the deployed HTTP/SSE gateway. With `CWEB_GATEWAY_URL`, `CWEB_GATEWAY_ORIGIN`, `CWEB_GATEWAY_TOKEN`, and `CWEB_GATEWAY_MODEL_TURN=1`, it additionally validates login-cookie attributes, wrong-origin rejection, SSE connected/heartbeat delivery, Cloudflare presence when remote, persisted history, test-thread cleanup, and logout without printing the token or session cookie.

## Relationship to OpenAI

This is an independent client for an official OpenAI Codex interface; it is not affiliated with or endorsed by OpenAI. It intentionally does not call private ChatGPT backend endpoints.
