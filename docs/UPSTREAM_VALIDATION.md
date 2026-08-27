# Upstream Validation — v0.4.0

The runtime probe must cover both official history contracts: a Web-created thread should request and report `historyMode:'paginated'` when supported, while an existing `historyMode:'legacy'` thread must load through `thread/read(includeTurns:true)` without a paginated item call. A schema-only pass is not closure evidence.

The archive baseline is official `@openai/codex 0.149.1`.

CI installs that exact version twice: one blocking stable seal and one blocking experimental seal. Both regenerate App Server JSON Schema and TypeScript from the installed binary. The stable seal verifies the public stable protocol; the experimental seal verifies the extra experimental ServerRequest disposition plus `thread/start.dynamicTools` availability.

Deployment validation must also exercise the runtime method, not only generated schema. In particular, a pinned deployment should perform an authenticated read-only `thread/turns/list` plus `thread/items/list` probe against the same App Server binary used by the Web gateway. The Web client retains a bounded stable-read fallback for runtimes that advertise but reject optional history methods.

A scheduled/push advisory job installs `@openai/codex@latest` and runs both stable and experimental protocol seals. It is intentionally non-blocking for the archived baseline: upstream future drift should be visible without retroactively invalidating a previously sealed, pinned deployment.

The project also follows the stable MCP Apps `2026-01-26` contract for the Host capabilities it declares. The Web host uses official App Server MCP proxy methods rather than opening separate MCP transports from the browser.

No statement in this document means that private ChatGPT product APIs are part of the public App Server compatibility target.
