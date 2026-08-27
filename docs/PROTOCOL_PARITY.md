# Protocol Parity Seal — v0.4.0

## Authority

The installed official `codex` binary is the protocol authority. The gateway generates both JSON Schema and TypeScript with `codex app-server generate-json-schema` and `generate-ts`; JSON wire methods not covered by the TypeScript export fail closed.

Archive baseline: `@openai/codex 0.149.1`.

## Stable surface

All exported stable ClientRequest/ClientNotification methods are schema-gated. `initialize`/`initialized` are gateway-managed; remaining allowed methods are invocable through native UX or the Official APIs drawer.

The first-class timeline has an explicit disposition for every sealed official ThreadItem variant: `userMessage`, `hookPrompt`, `agentMessage`, `plan`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `webSearch`, `imageView`, `sleep`, `imageGeneration`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`.

## ServerRequest dispositions

| Method | Disposition |
| --- | --- |
| `item/commandExecution/requestApproval` | native Web approval |
| `item/fileChange/requestApproval` | native Web approval |
| `item/tool/requestUserInput` | native user-input UI |
| `mcpServer/elicitation/request` | native MCP elicitation UI |
| `item/permissions/requestApproval` | native permission UI |
| `item/tool/call` | configured native Dynamic Tool Host; official `-32601` error if unmatched |
| `account/chatgptAuthTokens/refresh` | platform-only; rejected |
| `attestation/generate` | platform-only; rejected and not advertised |
| `currentTime/read` | experimental native clock host |
| `applyPatchApproval` | native legacy approval |
| `execCommandApproval` | native legacy approval |

## MCP Apps

Stable MCP Apps hosting is real, not a capability stub. The client declares `io.modelcontextprotocol/ui` with MIME `text/html;profile=mcp-app`, uses the stable `2026-01-26` double-iframe sandbox architecture, and proxies resource/tool inventory and calls through official App Server MCP methods. Optional MCP Apps capabilities that are not implemented are not advertised.

## Experimental surface

New Web threads select `historyMode:'paginated'` when the experimental history surface is present; official legacy threads take the stable full-read path and do not invoke paginated item hydration.

`CWEB_EXPERIMENTAL=1` asks Codex to export/accept experimental protocol. The experimental seal separately regenerates the protocol and requires `currentTime/read` plus `thread/start.dynamicTools` on the pinned archive baseline. The pinned baseline also exposes the official `thread/turns/list`, `thread/items/list`, and `thread/searchOccurrences` history surfaces there; the Web client keeps quick view bounded to the 10 most recent Turn structures with one official `itemsView: notLoaded` page and no older-page control, then automatically hydrates those ten Turns through `thread/items/list` with bounded concurrency. Full-history mode alone walks cursors page-by-page with a sticky page marker/control; only older full-history Turn items are hydrated as the Turn approaches the viewport or on explicit request. Large official pages automatically retry at a smaller page size. If the runtime rejects an advertised optional history method, the browser disables that experimental history path for the process and reloads the selected thread once through stable `thread/read`; the rejected method is never retried in a loop. Full-history keyword search uses the official occurrence index, displays official snippets, loads the pages required to reveal matching Turns, and supplements them with a local pass over already-rendered work-process text. Human-facing running state follows the selected thread's official `turn/started`, `turn/*` terminal, and `thread/status/changed` events; the latter is handled at thread level because the official active-status payload does not carry a `turnId`. Local Web ownership is promoted only after a Web-issued `turn/start` is matched by the official `turn/started` event. Bounded periodic official read-only reconciliation covers both local and foreign active turns, and a terminal event schedules delayed authoritative reads so a missed `turn/completed` cannot leave the final answer or running state stale. External official activity cannot fabricate Web stop/context/plan UI; only the local Web turn marker enables those controls. Dynamic Tool auto-host configuration is refused in stable mode.

## Drift behavior

Pinned stable and pinned experimental jobs are blocking archive checks. A latest-version job runs both modes as an advisory canary. New official ThreadItem or ServerRequest surface without a declared disposition makes the corresponding protocol seal fail instead of silently degrading.

## Outside the parity boundary

Private ChatGPT backend endpoints, external-host ChatGPT auth-token refresh and attestation are not emulated. The project is parity with the public official Codex App Server contract and its host responsibilities, not a bit-for-bit clone of private ChatGPT product internals.
