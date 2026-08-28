# Upstream Validation — v0.4.0

The runtime probe must cover both official history contracts: a Web-created thread should request and report `historyMode:'paginated'` when supported, while an existing `historyMode:'legacy'` thread must load through `thread/read(includeTurns:true)` without a paginated item call. A schema-only pass is not closure evidence.

The archive baseline is official `@openai/codex 0.150.1`.

CI installs that exact version twice: one blocking stable seal and one blocking experimental seal. Both regenerate App Server JSON Schema and TypeScript from the installed binary. The stable seal verifies the public stable protocol; the experimental seal verifies the extra experimental ServerRequest disposition plus `thread/start.dynamicTools` availability.

Deployment validation must also exercise runtime behavior, not only generated schema. `CWEB_RUNTIME_SMOKE_MODEL_TURN=1 npm run smoke:runtime` starts the exact selected binary, performs authenticated account/model RPCs, creates a read-only paginated thread, completes a real model Turn, reads that Turn back through `thread/turns/list` and `thread/items/list`, verifies a unique persisted assistant sentinel, and deletes the test thread. The Web client retains a bounded stable-read fallback for runtimes that advertise but reject optional history methods.

For the 2026-08-28 archive, that authenticated model-Turn probe passed independently on both the rollback runtime (`0.149.1`) and the selected baseline (`0.150.1`). The generated 0.150.1 surface contains 95 Stable ClientRequests, 153 Experimental ClientRequests, 79 ServerNotifications, 10 Stable/11 Experimental ServerRequests, and 18 ThreadItem variants. The universal bounded notification observer closes the generic disposition for all 79 current notifications, including the newly exported realtime and MCP event-stream notifications.

The installed 0.150.1 package SRI (`sha512-knrbhpJH3mEULAVStcZW4F5WEt9MQhBj6KFOonBSIUGTLcHlu9CE7FRmr95E33y94+sWNZSeVBBV/kYvlfgxkQ==`) exactly matched the current npm registry artifact. On this sealed Linux x64 host, the native executable SHA-256 is `abf1bb1643a79f73aa78ee627e111e02d4f8c98f25813a0cf6ce277709664386`. The regenerated Stable and Experimental schema digests are respectively `a1e1c28dc8e1b3220e086d17cde62b457f96c323a6ff5577bd79a726d3c86c99` and `6b822bc5f098e374f23117184b15e3c41aa1e746f5e273b3f0f9d9db44990aad`.

The same real model-Turn proof also passed through `https://codex.2919892.xyz`: Cloudflare, HTTPS login, Secure/HttpOnly/SameSite cookie, exact-origin rejection, SSE `connected` plus 15-second heartbeat, persistent official WebSocket transport, `thread/turns/list`, `thread/items/list`, unique assistant sentinel, thread deletion, and logout. This is the closure proof for the original Web-created paginated-history failure.

A scheduled/push advisory job installs `@openai/codex@latest` and runs both stable and experimental protocol seals. It is intentionally non-blocking for the archived baseline: upstream future drift should be visible without retroactively invalidating a previously sealed, pinned deployment.

The project also follows the stable MCP Apps `2026-01-26` contract for the Host capabilities it declares. The Web host uses official App Server MCP proxy methods rather than opening separate MCP transports from the browser.

No statement in this document means that private ChatGPT product APIs are part of the public App Server compatibility target.
