# Protocol Parity Seal

This document defines the archive-grade Web parity boundary for Codex App Server Web.

## Source of truth

The gateway does not maintain a handwritten RPC allow-list. At runtime and in CI it generates the official protocol from the installed `codex` binary with:

```text
codex app-server generate-json-schema
codex app-server generate-ts
```

JSON wire methods and TypeScript exports are cross-checked and tied to the exact Codex version/schema digest.

## ThreadItem UI coverage

The Web timeline has an explicit first-class disposition for every currently known official `ThreadItem` variant:

- `userMessage`
- `hookPrompt`
- `agentMessage`
- `plan`
- `reasoning`
- `commandExecution`
- `fileChange`
- `mcpToolCall`
- `dynamicToolCall`
- `collabAgentToolCall`
- `subAgentActivity`
- `webSearch`
- `imageView`
- `sleep`
- `imageGeneration`
- `enteredReviewMode`
- `exitedReviewMode`
- `contextCompaction`

The sealed UI keeps raw streaming text separately from rendered DOM, so code-block controls cannot corrupt later deltas. `item/started` and `item/completed` are always reconciled inside their authoritative Turn block.

## ServerRequest coverage

| Method | Disposition |
| --- | --- |
| `item/commandExecution/requestApproval` | Native Web approval |
| `item/fileChange/requestApproval` | Native Web approval |
| `item/tool/requestUserInput` | Native question UI |
| `mcpServer/elicitation/request` | Native form/URL elicitation |
| `item/permissions/requestApproval` | Native permission UI |
| `item/tool/call` | Structured manual tool-host response |
| `applyPatchApproval` | Native legacy approval vocabulary |
| `execCommandApproval` | Native legacy approval vocabulary |
| `account/chatgptAuthTokens/refresh` | Platform-only; rejected from browser boundary |
| `attestation/generate` | Platform-only; not advertised and rejected |

V2 approval decisions and legacy `ReviewDecision` values are deliberately separate. MCP elicitation responses always include the official `action`, `content`, and `_meta` fields.

## Capability honesty

The Web client advertises `openai/form`, which it implements.

It does **not** advertise `io.modelcontextprotocol/ui` / MCP Apps hosting. A compliant MCP Apps host requires a sandboxed iframe plus the complete bidirectional host bridge and authorization/audit semantics; rendering an arbitrary HTML resource is not sufficient. Until that host exists, claiming the extension would be a false capability declaration.

`requestAttestation` is not advertised. Attestation and ChatGPT auth-token refresh requests stay outside the browser trust boundary.

## Future-drift seal

`npm run seal:core` also runs `scripts/protocol-seal.mjs`. It regenerates the official stable protocol and fails when:

1. the official Codex release contains a `ThreadItem` variant that has no declared Web disposition; or
2. the official Codex release contains a `ServerRequest` method that has no declared trust/UI disposition.

The pinned CI job protects the archived baseline. The latest-version advisory job acts as an upstream canary, so new official protocol surface is detected before it silently becomes a UI bug.

## Non-goals

This project targets official `codex app-server` parity, not private ChatGPT Desktop internals. It does not call private ChatGPT backend endpoints, does not scrape a terminal UI, and does not directly own or mutate Codex authentication/config state files.
