# Security Model

This application is equivalent to remote interactive access to the Codex account and the selected host filesystem. Treat access to it as highly privileged.

## Defaults

- Authentication is required by default.
- The server binds to `127.0.0.1` by default.
- A non-loopback bind is refused when application authentication is disabled.
- JSON mutation endpoints require `application/json` or `application/*+json`.
- State-changing requests require an exact same Origin, or the configured `CWEB_PUBLIC_ORIGIN`.
- Session cookies are HttpOnly and SameSite=Strict. Configure an HTTPS `CWEB_PUBLIC_ORIGIN` for remote production so cookies are also Secure.
- Login attempts are rate limited.
- Static responses use CSP, no-sniff, frame denial, and no-referrer headers.

## Recommended remote access

Keep `CWEB_HOST=127.0.0.1` and place the application behind one trusted layer such as Tailscale, an authenticated HTTPS reverse proxy, or an SSH tunnel. Do not router-forward the raw HTTP port to the public Internet.

## Codex isolation

The source tree is checked for direct credential/config ownership patterns, private ChatGPT backend calls, Codex installer/upgrader behavior, and process-wide kill commands. The gateway only launches `codex app-server --listen stdio://` and kills the exact child it owns.

The application intentionally does **not** prevent users from invoking an official state-changing method that appears in the stable schema. For example, if upstream exposes an official config-write method, the Official APIs panel can call it. This is an explicit user request routed through Codex, not a bypass.

## Experimental APIs

Experimental protocol support is opt-in. Do not enable `CWEB_EXPERIMENTAL=1` on a sealed deployment unless you explicitly accept upstream compatibility risk.

## Disclosure

If you find a vulnerability, do not publish access tokens, Codex credentials, workspace data, or live exploit details. Report with a minimal reproduction and the affected commit/version.
