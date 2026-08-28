# Archive Contract — v0.4.0

This document defines what “final archive” means for this repository.

## Frozen baseline

- application version: `0.4.0`
- Node.js: `>=22.12.0`
- validated official Codex: `@openai/codex 0.150.1`
- product transport: official `codex app-server --listen ws://127.0.0.1:43999` under the Linux installer’s separate systemd user service; portable stdio remains supported for manual startup
- runtime npm dependencies: zero
- MCP Apps protocol: stable `2026-01-26`

A deployment intended to remain unchanged should pin the validated Codex version. The latest-Codex workflow is an advisory drift detector, not a promise of compatibility with unknown future releases.

The browser history path treats schema advertisement as necessary but not sufficient evidence: if the runtime rejects an optional paginated-history method, the Web client disables that experimental path for the process, performs one stable `thread/read` reload, and does not enter a retry loop.

## Required closure evidence

A sealed source tree must pass:

1. `npm ci --ignore-scripts`
2. `npm run manifest:verify`
3. `npm test`
4. `npm run check`
5. `npm run audit:official`
6. pinned stable official schema/protocol seal
7. pinned experimental official protocol seal
8. latest stable+experimental advisory canary

The deployment host must additionally pass `CWEB_RUNTIME_SMOKE_MODEL_TURN=1 npm run smoke:runtime` against the exact pinned binary and `CWEB_GATEWAY_MODEL_TURN=1 npm run smoke:gateway` against the published origin before publication. The first proves the runtime directly. The second repeats the authenticated model Turn through HTTP auth, origin enforcement, SSE/heartbeat and any reverse tunnel; both validate the persisted Turn/items including a unique assistant sentinel and delete the test thread in `finally` cleanup.

The CI-tested pull-request head tree and the squash-merged `main` tree must be byte-identical even though their commit SHAs differ.

## Official-interface rule

The gateway may invoke only methods present in the installed official App Server schema. It does not maintain a handwritten ClientRequest allow-list. Browser-originated requests pass schema, access-profile and origin/auth gates.

The human-facing Web surface includes official image input, an inventory summary for MCP servers/Skills/Plugins/installed Apps, and a collapsed technical view for method identifiers, schemas, parameters, and results. Image attachments are bounded and sent as the official `UserInput` `image` variant; arbitrary generic-file upload is not invented where the official protocol has no such input variant.

Server-initiated requests require an explicit disposition. Unknown official evolution is fail-closed. Platform-only token refresh and attestation are rejected instead of emulated.

Every schema-admitted server notification is observable through the bounded Official Events log before first-class timeline/state handling. This universal fallback is an observability disposition, not a claim that every transport/process event belongs in the conversation timeline.

## Host rule

MCP Apps and Dynamic Tools are client-host responsibilities delegated by official protocols, not private backend replacements. MCP Apps are stable and capability-negotiated. Dynamic Tool injection and `currentTime/read` are experimental and require experimental mode.

## Non-interference rule

The repository does not directly own Codex credentials/config/session files, install or upgrade Codex, call private ChatGPT backend endpoints, or kill unrelated Codex processes.

## Verification limitation

Repository CI can verify official schema generation, process protocol, sandbox/host logic and fake-App-Server end-to-end behavior without user secrets. A real authenticated model turn necessarily depends on credentials on the deployment machine and is not claimed unless actually executed there.

## Runtime recovery and single-writer boundary

New threads explicitly request the official paginated history contract when it is advertised. A thread whose official `historyMode` is `legacy` is never sent to `thread/turns/list` or `thread/items/list`; it is loaded with stable `thread/read(includeTurns:true)`, and the paging/search controls remain unavailable for that thread.

The Web gateway exposes a per-boot runtime identity in `/api/meta` and the SSE `connected` event. Selection and recovery use official `thread/read` plus official paged history; they do not implicitly call `thread/resume`. An explicit Web write may resume the selected thread, while an actual active-writer response is surfaced as a read-only state. Official runtime activity and local Web ownership are separate UI facts: all selected Web views may display the official Turn as running, but only the Web tab with the matching local turn marker may steer, stop, compact, or show local live context usage. The sidebar’s single Web-write switch is enforced again at the gateway for every non-read RPC, notification, and browser response; there is no additional desktop-ownership switch, and the official protocol remains the authority for concurrent writes.

The SSE stream includes a gateway heartbeat data frame in addition to the proxy keep-alive comment. It is consumed only by the connection watchdog, never rendered as a protocol or conversation item. A healthy stream with no conversation activity therefore remains observable, while a half-open mobile/desktop socket is replaced and followed by authoritative state reconciliation.

The Linux archive deployment keeps the official App Server in a separate `codex-official-app-server.service`, so stopping/restarting only the Web gateway leaves an in-flight official Turn owned by the official service. Notifications missed during a disconnected Web gateway are not invented or replayed; authoritative official thread state is re-read. Stopping the official App Server itself, or losing the machine, terminates the Turn, and no official method resurrects that dead generation.

History is sealed as two explicit read paths: quick view requests one official `thread/turns/list` `itemsView: notLoaded` page containing the 10 newest Turns and never renders an older-page control, then automatically hydrates all ten recent Turns through official `thread/items/list` calls with bounded concurrency; full-history view walks official cursors one page at a time using the same lightweight structure. Only older full-history Turn items are fetched lazily as a Turn approaches the viewport or the user explicitly requests them. The active quick-view Turn is included in the hydration path, while live SSE items and an optimistic user message remain visible during reconciliation. If an advertised optional history method is rejected, the client clears only its bounded history UI state, hides experimental paging/search controls, and reloads the selected thread through stable `thread/read` exactly once. Full-history search uses official `thread/searchOccurrences` pages and displays official snippets before item hydration. The official plan card is a persistent bottom affordance; live plan updates preserve a mobile user’s explicit expanded state. The Web performs bounded read-only reconciliation for both locally owned and externally active Turns, and performs two delayed authoritative reads after a terminal event, so loss of only `turn/completed` cannot leave the local running indicator or final assistant answer permanently stale.
