# Upstream validation snapshot

Validated against OpenAI `openai/codex` `main` observed on 2026-08-24 at commit:

`80cce09d059780528e59353ab3d87e4c97d1e944`

The project architecture was checked against the official App Server documentation and schema layout at that revision:

- `codex app-server` is the rich-interface backend used by Codex integrations;
- stable production transport is JSONL over `stdio`; its network WebSocket listener is experimental/unsupported;
- `generate-json-schema` / `generate-ts` are version-specific and match the installed Codex version;
- request/server-request schemas use tagged `oneOf` alternatives with fixed `method` values, which is the mechanism consumed by `OfficialSchemaRegistry`.

Runtime deployments do not pin themselves to this repository commit. They regenerate schemas from the **locally installed official Codex binary**, which remains authoritative for protocol acceptance.
