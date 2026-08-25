# Product Host Contracts

v0.4.0 adds two explicit host surfaces on top of the official Codex App Server. Neither replaces an OpenAI API: both implement client responsibilities that the official bidirectional protocol delegates to the embedding product.

## MCP Apps Host — Stable

The gateway advertises the official MCP extension profile during `initialize`:

```json
{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}
```

The browser host implements MCP Apps protocol `2026-01-26` for the capabilities it declares. It discovers `mcpToolCall` items, reads the `ui://` resource with official `mcpServer/resource/read`, validates `text/html;profile=mcp-app`, then mounts it through an opaque-origin Sandbox Proxy and a second App iframe. The iframe profile is `allow-scripts allow-same-origin allow-forms`; popup, top-navigation and download escape flags are absent.

The Host proxies the MCP inventory/call surfaces required by Apps through official App Server methods: `mcpServerStatus/list`, `mcpServer/resource/read`, and `mcpServer/tool/call`. Calls are scoped to the originating MCP server/thread and tool visibility is enforced. Resource bytes, postMessage envelopes, inventory pagination/cache cardinality, sessions and concurrent App requests are bounded.

Declared Host capabilities are intentionally conservative: server tools/resources, logging, sandbox metadata and external links. Optional `downloadFile`, sampling and model-context/message capabilities are not advertised unless they have a complete host implementation.

## Dynamic Tool Host — Experimental

Dynamic Tools are an official experimental App Server facility. A configured host therefore requires `CWEB_EXPERIMENTAL=1`; stable mode never injects `dynamicTools` into `thread/start`.

`CWEB_DYNAMIC_TOOLS_FILE` points to an operator-owned JSON file (`version: 1`). Each entry maps an official function or namespace tool definition to one absolute local executable. The gateway injects only the canonical public tool specs into `thread/start.dynamicTools`; handler command/cwd/environment remain private host configuration.

When Codex sends `item/tool/call`, a matching handler receives one JSON request on stdin and returns one JSON response on stdout. It is started with `shell:false`, a minimal environment, explicit inheritance only, no `CWEB_*` variables, bounded input/output/media, bounded concurrency and timeout, and bounded TERM→KILL cleanup on gateway shutdown. Tool/namespace identifiers and reserved namespaces follow the official Codex validator.

Unconfigured `item/tool/call` requests are not fabricated as successful. They remain visible to the existing structured manual-response UI.

## Experimental external clock

When experimental mode is enabled and official schema contains `currentTime/read`, the gateway answers it locally with whole Unix seconds as `{ "currentTimeAt": ... }`. Stable mode does not advertise experimental API and therefore does not receive this request.

## Trust boundary

MCP App HTML is untrusted browser content. Dynamic Tool executables are explicitly operator-trusted native programs. The Web Host does not claim to sandbox arbitrary native executables; use OS/container isolation for untrusted handlers.
