# Production Seal — v0.4.0

## Runtime invariants

- auth is on by default;
- unauthenticated non-loopback bind is refused;
- state-changing API requests require same-origin validation;
- the Linux archive deployment runs the official App Server as a separate supervised WebSocket service; the Web gateway may also use the portable owned stdio child mode;
- the official service binds only to loopback, and receives no Web session token or other `CWEB_*` setting;
- RPCs, server requests, stdin, JSONL lines, HTTP bodies, SSE clients/events/queues, sessions and rate-limit keys are bounded; each SSE client has an independent keep-alive and backpressure boundary;
- crashes clear stale ServerRequests and restart with bounded exponential delay;
- shutdown terminates only owned children.

## Web delivery and live-state invariants

- every Web `turn/start` carries an official client message id and a persisted, bounded pending-submission record; live `turn/steer` submissions also carry the same official identifier class;
- the gateway keeps only a bounded, expiring result cache for repeated `turn/start`/`turn/steer` requests with the same thread and official client message id;
- an ambiguous transport result is quarantined and reconciled through official paginated history; the client never retries an unknown submission automatically;
- a confirmed submission clears the composer exactly once, while a definite rejection removes only its optimistic message and leaves a deliberate retry path;
- active duration is derived from the official start timestamp and ticks locally only while the official/local Turn is active; terminal Turns stop the clock;
- the gateway keeps only bounded, expiring active `turn/plan/updated` snapshots and includes them in every new SSE `connected` frame; terminal, idle, crash, and exit paths remove them;
- a Web plan card is rendered only from an official plan snapshot and is cleared by an official terminal/empty-plan signal; it never advances by a local timer;
- live Turn items are retained and merged into the terminal representation, so the completed work process is not discarded when a summary Turn is replaced;
- delivery state, pending timers, and live-item caches are scoped to a thread and cleaned when that thread is cleared.

## History invariants

- quick view always requests a fresh official recent summary page on an explicit thread selection, visibly labels the bounded recent window, and never exposes an older-page control;
- full-history mode is the only path that follows official cursors beyond the recent page; its Turn work-process items remain per-Turn lazy reads, so selecting a thread does not aggregate the entire conversation into one response;
- superseded history reads cannot overwrite a newer selection or its page cursor.

## Protocol invariants

- official JSON and TypeScript exports are regenerated from the installed Codex binary;
- invocation is gated by the official wire schema;
- Stable and Experimental ServerRequest/ThreadItem dispositions are sealed separately;
- MCP Apps is advertised only when required official MCP proxy methods are present;
- configured Dynamic Tools require experimental mode and an official experimental `thread/start.dynamicTools` schema field.

## MCP Apps invariants

Untrusted App HTML is never injected into the product document. It crosses an opaque-origin Sandbox Proxy before reaching the inner App iframe. App resource MIME/URI/size, postMessage source/origin/size, permissions, inventory cardinality and tool visibility are checked. Optional host capabilities that are not implemented remain undeclared.

## Dynamic Tool invariants

Handlers use absolute executable/cwd paths, `shell:false`, stdin JSON, minimal environment, no `CWEB_*` inheritance, official identifier rules, bounded concurrency/time/output/media, and owned-process cleanup.

## Deployment

Use the supplied systemd user-service installer or equivalent supervision. For remote access, terminate HTTPS/authentication on a trusted reverse proxy or use a private tunnel; do not expose an unauthenticated raw port.
