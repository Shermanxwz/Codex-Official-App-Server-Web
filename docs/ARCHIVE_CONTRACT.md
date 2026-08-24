# Archive Contract

This document defines what `ARCHIVE_READY` means for Codex App Server Web.

## Stable protocol contract

The production default is the stable official Codex App Server protocol. On startup the gateway asks the installed official `codex` executable to generate both:

- JSON Schema exports (`generate-json-schema`), and
- TypeScript exports (`generate-ts`).

For all four protocol directions, the JSON Schema is the authoritative current wire method set. Every JSON wire method must also be present in the independent TypeScript export; a missing TypeScript counterpart fails closed with `OFFICIAL_PROTOCOL_EXPORT_DRIFT`. TypeScript-only legacy/type exports are recorded for diagnostics but do not enlarge the browser wire allow-list.

Every stable client method in the authoritative JSON wire set is represented by the Web protocol surface. `initialize` and `initialized` are counted as implemented but are gateway-managed lifecycle messages; the browser cannot send a second handshake.

The JSON parameter schema is exposed on demand for the generic Official APIs surface. The gateway intentionally does not pretend to be a second implementation of Codex parameter semantics: raw parameters are ultimately validated by the official App Server. This also means an upstream JSON-schema field omission does not force the gateway to strip an otherwise valid field supplied in raw JSON.

## Server-to-client contract

Every stable official server request/notification method is admitted only when present in the loaded official exports. Unknown server methods are rejected or suppressed and surfaced as a protocol mismatch rather than silently treated as supported.

Core human approvals (commands and file changes) have native UI. Other official server requests have a generic JSON response surface. Some server requests inherently require host capabilities outside a pure browser client (for example platform attestation or a client-managed external auth-token provider). The project does not bypass Codex or read `auth.json` merely to auto-fulfil those requests.

Therefore:

- **stable wire/API method coverage:** required to be 100%;
- **core Codex workflow UI:** required to be native and bilingual;
- **host-specific external capabilities:** represented through the official protocol, but only automated when they can be implemented without violating the trust boundary.

## Isolation contract

- The gateway starts a separate `codex app-server --listen stdio://` child.
- All `CWEB_*` environment variables, including the Web access token, are removed before any Codex subprocess launch.
- The gateway never scans for or kills unrelated Codex processes.
- Project-owned state stays outside `CODEX_HOME`.
- Official config/filesystem/account mutation methods may mutate Codex state **through Codex itself**. This is not a direct gateway write.

## Availability contract

- Unexpected App Server exit clears stale server-request IDs and is automatically retried with bounded exponential backoff.
- Browser SSE clients have bounded buffered output. Slow clients are disconnected rather than allowed to grow server memory without limit.
- RPC count, App Server stdin buffering, JSONL line size, HTTP request body size, and browser event size are bounded.
- Browser reconnect performs an authoritative thread/list/thread-read resynchronization rather than replaying uncertain writes.
- Existing stored threads are resumed through official `thread/resume` before a new turn is started when required.

## Reproducibility contract

- Runtime npm dependencies remain zero.
- GitHub Actions are pinned to exact action commit SHAs.
- The required protocol CI job uses an explicit known-good official Codex version.
- A separate `latest` job is advisory and may fail without invalidating an already sealed archive version.
- `SOURCE_MANIFEST.sha256` must match every tracked source/artifact file covered by the manifest.

## Final target-host seal

Hosted CI cannot prove the state of the user's real Linux account, ChatGPT/Codex login, filesystem, or locally installed Codex binary. Final archive readiness therefore requires running on the target host:

```bash
npm run seal
```

Only that command, on the target machine with the real official Codex login, is allowed to print `ARCHIVE_READY`.
