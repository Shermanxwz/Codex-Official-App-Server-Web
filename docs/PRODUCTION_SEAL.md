# Production Seal — v0.4.0

## Runtime invariants

- auth is on by default;
- unauthenticated non-loopback bind is refused;
- state-changing API requests require same-origin validation;
- the Linux archive deployment runs the official App Server as a separate supervised WebSocket service; the Web gateway may also use the portable owned stdio child mode;
- the official service binds only to loopback, and receives no Web session token or other `CWEB_*` setting;
- RPCs, server requests, stdin, JSONL lines, HTTP bodies, SSE clients/events, sessions and rate-limit keys are bounded;
- crashes clear stale ServerRequests and restart with bounded exponential delay;
- shutdown terminates only owned children.

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
