# Security

## Network and browser boundary

Authentication is on by default. Non-loopback bind without authentication is refused. State-changing Web API calls require an exact same-origin check. `CWEB_PUBLIC_ORIGIN`, when set, must be an exact HTTP(S) origin.

The product page uses a restrictive CSP and allows `frame-src data:` only for the MCP Apps Sandbox Proxy. The page itself remains non-frameable (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).

## MCP Apps

MCP App HTML is untrusted.

- Web rendering uses the spec-required intermediate Sandbox Proxy on a different opaque origin.
- The inner App iframe follows the stable reference sandbox profile (`allow-scripts allow-same-origin allow-forms`). Its same-origin relationship is only with the already isolated outer proxy; it is never same-origin with the product Host page. Popups, top-navigation, downloads and unsandboxed escape flags remain absent.
- App CSP is generated from `_meta.ui.csp`; undeclared external connections/frames are denied. The sandbox follows the stable reference compatibility profile, including same-origin/inline/eval/blob allowances inside the already isolated sandbox origin; those allowances never apply to the product Host page.
- Powerful browser permissions are disabled unless explicitly allowed with `CWEB_MCP_APP_PERMISSIONS` and requested by the resource; browser secure-context and Permissions Policy enforcement may still deny them.
- postMessage traffic is source/origin-checked, JSON-RPC checked and size-bounded; initialization ordering and per-session request concurrency are bounded.
- App tool calls are scoped to the originating MCP server and blocked when tool visibility excludes `app`; inventories/caches/list pages also have cardinality bounds.
- External links are host-mediated and require user confirmation. `downloadFile` is not advertised; sandboxed Apps cannot assume host file-download support.

## Dynamic Tool Host

Dynamic Tools are operator-defined executable integrations and require experimental mode.

- executable command and cwd must be absolute;
- `spawn` always uses `shell:false`;
- model arguments travel only over stdin JSON;
- process environment is minimal, with explicit `inheritEnv` allow-list entries;
- every `CWEB_*` name is forbidden from Dynamic Tool inheritance;
- config size/count, request size, runtime, stdout and returned content are bounded;
- image/audio outputs must be inline base64 data URLs.

A Dynamic Tool executable itself is trusted operator code. The host does not claim to sandbox arbitrary native executables beyond the process/environment/resource boundary above; use OS/container isolation if a handler is not trusted.

## Codex non-interference

The gateway never directly reads or writes Codex `auth.json`, `config.toml` or rollout/session files. It does not install/upgrade Codex, and it never uses process-wide kill commands. All `CWEB_*` variables are stripped from the Codex App Server environment.

Platform-only `account/chatgptAuthTokens/refresh` and `attestation/generate` are rejected from the browser boundary rather than emulated.

## Resource bounds

Pending RPCs/ServerRequests, App Server stdin, JSONL records, HTTP bodies, SSE slow-client buffers, event frames, sessions, rate-limit keys, MCP App messages/resources/inventories, and Dynamic Tool runtime/output are bounded.
