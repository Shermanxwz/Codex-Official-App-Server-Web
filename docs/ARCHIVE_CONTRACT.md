# Archive Contract — v0.4.0

This document defines what “final archive” means for this repository.

## Frozen baseline

- application version: `0.4.0`
- Node.js: `>=22.12.0`
- validated official Codex: `@openai/codex 0.149.1`
- product transport: official `codex app-server --listen ws://127.0.0.1:43999` under the Linux installer’s separate systemd user service; portable stdio remains supported for manual startup
- runtime npm dependencies: zero
- MCP Apps protocol: stable `2026-01-26`

A deployment intended to remain unchanged should pin the validated Codex version. The latest-Codex workflow is an advisory drift detector, not a promise of compatibility with unknown future releases.

## Required closure evidence

A sealed source tree must pass:

1. `npm ci --ignore-scripts`
2. `npm run manifest:verify`
3. `npm test`
4. `npm run check`
5. pinned stable official schema/protocol seal
6. pinned experimental official protocol seal
7. latest stable+experimental advisory canary

The CI-tested pull-request head tree and the squash-merged `main` tree must be byte-identical even though their commit SHAs differ.

## Official-interface rule

The gateway may invoke only methods present in the installed official App Server schema. It does not maintain a handwritten ClientRequest allow-list. Browser-originated requests pass schema, access-profile and origin/auth gates.

The human-facing Web surface includes official image input, an inventory summary for MCP servers/Skills/Plugins/installed Apps, and a collapsed technical view for method identifiers, schemas, parameters, and results. Image attachments are bounded and sent as the official `UserInput` `image` variant; arbitrary generic-file upload is not invented where the official protocol has no such input variant.

Server-initiated requests require an explicit disposition. Unknown official evolution is fail-closed. Platform-only token refresh and attestation are rejected instead of emulated.

## Host rule

MCP Apps and Dynamic Tools are client-host responsibilities delegated by official protocols, not private backend replacements. MCP Apps are stable and capability-negotiated. Dynamic Tool injection and `currentTime/read` are experimental and require experimental mode.

## Non-interference rule

The repository does not directly own Codex credentials/config/session files, install or upgrade Codex, call private ChatGPT backend endpoints, or kill unrelated Codex processes.

## Verification limitation

Repository CI can verify official schema generation, process protocol, sandbox/host logic and fake-App-Server end-to-end behavior without user secrets. A real authenticated model turn necessarily depends on credentials on the deployment machine and is not claimed unless actually executed there.

## Runtime recovery and single-writer boundary

The Web gateway exposes a per-boot runtime identity in `/api/meta` and the SSE `connected` event. Selection and recovery use official `thread/read` plus official paged history; they do not implicitly call `thread/resume`. An explicit Web write may resume the selected thread, while an active-writer response is surfaced as a read-only state. The sidebar’s Web-write switch is enforced again at the gateway for every non-read RPC, notification, and browser response. The desktop-ownership switch coordinates this Web behavior only; the official protocol does not expose a method that revokes another official client’s write permission.

The Linux archive deployment keeps the official App Server in a separate `codex-official-app-server.service`, so stopping/restarting only the Web gateway leaves an in-flight official Turn owned by the official service. Notifications missed during a disconnected Web gateway are not invented or replayed; authoritative official thread state is re-read. Stopping the official App Server itself, or losing the machine, terminates the Turn, and no official method resurrects that dead generation.
