# Architecture

## 1. Trust boundary

The browser never talks to Codex directly. It talks to a same-origin HTTP gateway. The gateway owns one child `codex app-server --listen stdio://` process and only that process.

The gateway does not interpret or reproduce Codex business logic. It performs four jobs:

1. generate the official JSON Schema with the installed `codex` binary;
2. construct an allow-list of official client request/notification methods;
3. bridge schema-approved browser calls to JSONL-over-stdio;
4. forward Codex notifications/server-initiated requests back to authenticated browsers.

## 2. Protocol coverage

`OfficialSchemaRegistry` loads `ClientRequest.json`, `ClientNotification.json`, `ServerRequest.json`, and `ServerNotification.json`. Each schema is a tagged `oneOf` whose alternatives contain a fixed `method` enum. The registry extracts those tags at runtime.

This makes API coverage set-based rather than hand-maintained:

```text
accepted browser request methods == official ClientRequest method set
accepted browser notification methods == official ClientNotification method set
observed server requests == official ServerRequest method set
observed server notifications == official ServerNotification method set
```

Stable and experimental schemas are generated separately. Stable is the production default.

## 3. Transport

App Server Web deliberately uses `stdio`, not the experimental App Server WebSocket listener. Browser streaming uses SSE because the browser only needs a server-to-client event stream; mutations use authenticated same-origin JSON POST requests. Server-initiated Codex requests are answered via a dedicated HTTP endpoint correlated by the official request id.

## 4. No Codex ownership

The project does not directly operate on files inside `CODEX_HOME`. Official methods such as `config/value/write` may cause **Codex itself** to mutate its own state. That is allowed because the request remains an official Codex operation.

The invariant is therefore `Never bypass Codex`, not `Codex state can never change`.

## 5. Process isolation

Each gateway instance starts one child App Server and stores its PID only through the Node child-process object. Shutdown sends SIGTERM only to that owned child. There is no process-name lookup and no global kill.

Other App Server processes are outside the gateway's lifecycle boundary.

## 6. State

Project-owned persistent data is restricted to XDG paths. Stable schemas are cached under the state directory. Browser sessions are memory-only. The systemd install environment file is mode 0600.

## 7. UI architecture

The Web UI has two layers:

- dedicated user experience for threads, turns, stream events, approvals, and common operations;
- a complete Official APIs surface generated from the current method registry.

The second layer is a compatibility escape hatch: a newly added stable method becomes usable before a bespoke workflow is written.
