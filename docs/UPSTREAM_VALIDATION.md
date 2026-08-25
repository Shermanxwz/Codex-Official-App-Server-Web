# Upstream Validation — v0.4.0

The archive baseline is official `@openai/codex 0.149.1`.

CI installs that exact version twice: one blocking stable seal and one blocking experimental seal. Both regenerate App Server JSON Schema and TypeScript from the installed binary. The stable seal verifies the public stable protocol; the experimental seal verifies the extra experimental ServerRequest disposition plus `thread/start.dynamicTools` availability.

A scheduled/push advisory job installs `@openai/codex@latest` and runs both stable and experimental protocol seals. It is intentionally non-blocking for the archived baseline: upstream future drift should be visible without retroactively invalidating a previously sealed, pinned deployment.

The project also follows the stable MCP Apps `2026-01-26` contract for the Host capabilities it declares. The Web host uses official App Server MCP proxy methods rather than opening separate MCP transports from the browser.

No statement in this document means that private ChatGPT product APIs are part of the public App Server compatibility target.
