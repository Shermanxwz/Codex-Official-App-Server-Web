# Architecture

## Control plane

```text
Browser
  ├─ native Codex conversation UI
  ├─ Official APIs schema drawer
  └─ MCP Apps Host
       └─ opaque-origin Sandbox Proxy iframe
            └─ untrusted MCP App srcdoc iframe
           HTTP/SSE
              |
              v
Node Web Gateway
  ├─ auth / same-origin / access-profile gate
  ├─ official JSON+TS protocol registry
  ├─ stable + experimental disposition seal
  ├─ currentTime/read host responder
  └─ Dynamic Tool process host (optional, experimental)
              |
           stdio JSONL
              v
       official codex app-server
              |
              v
       official Codex runtime
```

## Protocol authority

At startup `OfficialSchemaRegistry` runs the installed Codex binary's `app-server generate-json-schema` and `generate-ts`. The JSON wire set is authoritative for invocation. TypeScript provides an independent export-coverage check. Cached schemas are tied to exact Codex version, mode and digest.

## Browser event model

The gateway converts official server notifications and non-host-managed ServerRequests into bounded SSE events. The browser keeps live item state keyed by official item id and re-reads authoritative thread state after reconnect rather than replaying uncertain writes. The UI groups non-message items into a compact work-process disclosure, routes an input during an active turn through official `turn/steer`, and surfaces official `thread/compacted` / `thread/compact/start` state without inventing a private conversation protocol.

The gateway writes no append-only conversation or runtime log files. Its only runtime-owned persistent data is the generated official schema cache; startup maintenance removes only stale, exact-name `.tmp`/`.bak` swap artifacts from that cache. Official Codex session/history storage remains owned by the official runtime and is intentionally not pruned by this project.

## MCP Apps

The capability is fixed during App Server initialization and flows downstream to MCP sessions. `mcpToolCall.appContext.resourceUri` (or the compatibility resource URI) selects the `ui://` resource. The host reads it through official `mcpServer/resource/read`, validates the MIME/profile and size, then sends raw HTML plus approved CSP/permissions to the outer Sandbox Proxy.

The outer proxy is a `data:` document, giving it an opaque origin different from the product page while still permitting the spec-required `allow-scripts allow-same-origin`. It creates the second iframe using the stable reference profile `allow-scripts allow-same-origin allow-forms`. That View can share the proxy's isolated origin, but it still cannot become same-origin with the product Host because the outer `data:` proxy has a distinct opaque origin. All View↔Host messages are JSON-RPC, origin/source-validated and size-bounded.

App server tool/resource calls are proxied back through official `mcpServer/*` App Server methods. Tool calls are scoped to the originating server and checked against `_meta.ui.visibility`.

## Dynamic Tools

Configured Dynamic Tool definitions are converted to the official canonical `thread/start.dynamicTools` shape only in experimental mode. When App Server sends `item/tool/call`, the gateway matches namespace+tool against the operator registry. Matching handlers are spawned directly with `shell:false`; arguments from the model are stdin JSON, never command-line shell text. Unmatched calls continue to the Web manual-response surface.

## Trust boundaries

The Web token authenticates only this gateway. It is stripped from Codex and Dynamic Tool child environments. Codex owns its own account/config/session state. MCP App code is untrusted. Dynamic Tool executables are operator-trusted local programs but are resource-bounded by the host.
