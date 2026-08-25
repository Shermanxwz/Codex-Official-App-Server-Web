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
| `item/tool/call` | configured native Dynamic Tool Host; manual fallback if unmatched |
| `account/chatgptAuthTokens/refresh` | platform-only; rejected |
| `attestation/generate` | platform-only; rejected and not advertised |
| `currentTime/read` | experimental native clock host |
| `applyPatchApproval` | native legacy approval |
| `execCommandApproval` | native legacy approval |

## MCP Apps

Stable MCP Apps hosting is real, not a capability stub. The client declares `io.modelcontextprotocol/ui` with MIME `text/html;profile=mcp-app`, uses the stable `2026-01-26` double-iframe sandbox architecture, and proxies resource/tool inventory and calls through official App Server MCP methods. Optional MCP Apps capabilities that are not implemented are not advertised.

## Experimental surface

`CWEB_EXPERIMENTAL=1` asks Codex to export/accept experimental protocol. The experimental seal separately regenerates the protocol and requires `currentTime/read` plus `thread/start.dynamicTools` on the pinned archive baseline. Dynamic Tool auto-host configuration is refused in stable mode.

## Drift behavior

Pinned stable and pinned experimental jobs are blocking archive checks. A latest-version job runs both modes as an advisory canary. New official ThreadItem or ServerRequest surface without a declared disposition makes the corresponding protocol seal fail instead of silently degrading.

## Outside the parity boundary

Private ChatGPT backend endpoints, external-host ChatGPT auth-token refresh and attestation are not emulated. The project is parity with the public official Codex App Server contract and its host responsibilities, not a bit-for-bit clone of private ChatGPT product internals.
