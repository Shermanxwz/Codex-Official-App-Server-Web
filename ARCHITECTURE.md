# Architecture

## 1. Trust boundary

The browser never talks to Codex directly. It talks to a same-origin HTTP gateway. The gateway owns one child `codex app-server --listen stdio://` process and only that process.

The gateway does not reproduce Codex business logic. It:

1. asks the installed official Codex binary to export JSON Schema **and** TypeScript protocol definitions;
2. requires the two official export sets to agree on method membership;
3. constructs bidirectional stable protocol registries;
4. bridges only schema-approved browser messages to JSONL-over-stdio;
5. forwards only schema-approved Codex notifications/server requests to authenticated browsers;
6. supervises only its own App Server child.

## 2. Protocol coverage and drift detection

`OfficialSchemaRegistry` loads both export forms for:

- `ClientRequest`
- `ClientNotification`
- `ServerRequest`
- `ServerNotification`

JSON request alternatives provide the parameter schema used by the generic Official APIs UI. The TypeScript export provides an independent upstream method-set check. If JSON and TypeScript disagree, startup fails with `OFFICIAL_PROTOCOL_EXPORT_DRIFT` rather than guessing which export is correct.

The stable contract is therefore set-based:

```text
implemented client requests      == official stable ClientRequest methods
implemented client notifications == official stable ClientNotification methods
accepted server requests         == official stable ServerRequest methods
accepted server notifications    == official stable ServerNotification methods
```

Connection lifecycle operations such as `initialize` / `initialized` are implemented by the gateway itself and are not re-exposed for duplicate browser invocation.

Experimental exports use a separate opt-in mode and are outside the archive promise.

## 3. Exact-version schema cache

Every schema cache contains a manifest with:

- exact output of `codex --version`;
- stable/experimental mode;
- SHA-256 digest of the JSON and TypeScript exports.

When refresh is disabled, all three must match before a cached schema is accepted. This prevents a stale cache from silently widening or narrowing the accepted protocol after a Codex upgrade/downgrade.

## 4. Transport

Codex transport is official `stdio` JSONL, not the experimental App Server network WebSocket listener. Browser mutations use authenticated same-origin JSON POSTs; browser streaming uses SSE.

Backpressure is explicit at each boundary: pending RPC count, App Server stdin buffering, JSONL record size, browser event size and slow-client SSE buffering are bounded.

## 5. Secret and process isolation

All project-owned `CWEB_*` environment variables are removed before launching **any** Codex subprocess, including version/schema commands and the long-lived App Server. Web login secrets therefore do not become Codex or agent-command environment variables.

Each gateway generation tracks an exact child-process object. Shutdown/crash handling signals only that child. There is no process-name lookup or global kill. Unexpected exit rejects pending RPCs, clears stale approval requests and permits a fresh official App Server generation.

## 6. Reconnect and state authority

The browser never assumes an SSE stream is a durable event log. After reconnect or a detected oversize/gap condition it re-reads authoritative thread/meta state. Uncertain writes are never automatically replayed.

Stored threads are checked with `thread/loaded/list`; when needed they are opened through the official `thread/resume` before a new turn is started.

## 7. No Codex ownership

The project does not directly operate on files inside `CODEX_HOME`. Official methods such as config writes may cause **Codex itself** to change its own state; that is an explicit official operation, not a bypass.

The invariant is `Never bypass Codex`, not `Codex state can never change`.

## 8. State

Project-owned persistent data uses XDG paths. Browser sessions are memory-only. Linux install secrets/service configuration are mode 0600 and the service uses `UMask=0077`.

## 9. UI architecture

The UI has two layers:

- native core UX for threads, turns, model/reasoning selection, streaming, interrupt and approvals;
- a generic Official APIs surface backed by the exact current parameter schema for every remaining stable client method.

This means a new upstream stable method is wire-usable before a bespoke workflow is designed, while high-frequency workflows remain simple rather than looking like a JSON-RPC debugger.
