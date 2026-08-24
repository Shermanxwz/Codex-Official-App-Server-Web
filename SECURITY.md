# Security Model

This application is equivalent to privileged remote interactive access to the Codex account and host workspaces. Treat Web access as highly privileged.

## Defaults

- Authentication is required by default.
- The server binds to `127.0.0.1` by default.
- A non-loopback bind is refused when app authentication is disabled.
- JSON mutation endpoints accept only `application/json` or `application/*+json`.
- State-changing requests require exact same Origin or exact configured `CWEB_PUBLIC_ORIGIN`.
- `CWEB_PUBLIC_ORIGIN` must be a bare HTTP(S) origin without path/query/hash/credentials.
- Session cookies are HttpOnly and SameSite=Strict; with HTTPS public origin they are Secure.
- Login attempts are rate limited.
- Static responses use CSP, no-sniff, frame denial and no-referrer headers.

## Browser-to-Codex protocol gate

The browser cannot submit an arbitrary JSON-RPC method name. A client request/notification must exist in the official stable schema exported by the installed Codex. Connection lifecycle methods are gateway-managed to prevent duplicate initialization.

The reverse direction is also gated: a server request or notification that is not present in the current official server-side export is not blindly forwarded. Unknown server requests are failed closed so they cannot remain pending invisibly.

## Dual-export fail-closed rule

The gateway generates both official JSON Schema and TypeScript exports. Their method sets must match. A mismatch is treated as an upstream protocol export drift and blocks startup rather than choosing one representation silently.

## Secret isolation

`CWEB_TOKEN` and every other `CWEB_*` variable are stripped before spawning Codex processes. This includes `codex --version`, schema generators and the long-lived `codex app-server`. The agent/runtime therefore does not inherit the Web access credential from this application.

The application does not read `auth.json` to implement UI features and does not send ChatGPT access tokens to the browser.

## Resource and availability boundaries

The service applies bounded limits to:

- request body size;
- pending Codex RPC count;
- queued App Server stdin bytes;
- App Server JSONL record size;
- individual browser events;
- slow-client SSE buffering.

An unexpected App Server exit rejects outstanding calls, clears stale approvals and is recovered with bounded exponential restart. Fatal startup configuration/schema errors do not enter an infinite systemd restart loop.

## Recommended remote access

Keep `CWEB_HOST=127.0.0.1` and place the application behind a trusted layer such as Tailscale, an authenticated HTTPS reverse proxy or an SSH tunnel. Do not router-forward the raw HTTP port to the public Internet.

## Codex ownership boundary

The source tree is checked for direct credential/config ownership patterns, private ChatGPT backend calls, Codex installer/upgrader behavior and process-wide kill commands. The gateway manages only its own official App Server child.

The application intentionally does **not** forbid a user from invoking an official state-changing method that exists in the stable schema. If upstream exposes config/file/account mutations, invoking them from the Official APIs panel is an explicit request routed through Codex.

Some official server requests may require a hosting capability that this standalone Web gateway deliberately does not possess (for example, an external platform-managed credential refresh or attestation provider). Such requests are surfaced/failed explicitly; the project will not violate the no-direct-credential boundary merely to claim automatic handling.

## Experimental APIs

Experimental protocol support is opt-in. Do not enable `CWEB_EXPERIMENTAL=1` on a sealed deployment unless you accept upstream compatibility risk.

## Source/release integrity

`SOURCE_MANIFEST.sha256` covers the repository's regular source/artifact files (excluding generated/runtime state). CI verifies the manifest before tests. Required CI also validates against a fixed known-good Codex version while an advisory job checks current `latest` compatibility.

## Disclosure

If you find a vulnerability, do not publish access tokens, Codex credentials, workspace data or live exploit details. Report a minimal reproduction with the affected commit/version.
