# Upstream validation snapshot

Archive hardening was reviewed on 2026-08-24 against the official OpenAI Codex App Server sources and a current official package baseline.

## Required reproducible baseline

CI pins:

```text
@openai/codex 0.149.1
```

This is a compatibility baseline, not a product-managed Codex dependency: the Web application never installs or upgrades Codex at runtime. The CI-only pinned job proves a known-good official protocol snapshot; a separate advisory job tests `@openai/codex@latest`.

## Official source snapshot observed during the review

OpenAI `openai/codex` `main` was inspected at commit:

```text
80cce09d059780528e59353ab3d87e4c97d1e944
```

The architecture was checked against official App Server behavior/schema layout:

- App Server is the backend intended to power rich Codex interfaces;
- local JSONL over `stdio` is the production transport used by this project; the network WebSocket listener is experimental/unsupported;
- `generate-json-schema` and `generate-ts` are version-specific exports from the installed Codex;
- protocol unions expose fixed method tags that can be converted into exact method sets;
- experimental methods/fields require explicit opt-in and are excluded from the stable archive contract.

## Runtime authority

A deployed instance does **not** trust this documentation snapshot to admit RPCs. The locally installed official Codex executable remains authoritative: the gateway generates its JSON and TypeScript exports, requires method-set parity, records exact version/digest, then gates traffic against those artifacts.

A future official release can therefore produce one of three outcomes:

1. compatible stable exports -> startup/seal passes;
2. new stable methods -> they become available through the schema-driven Official APIs surface automatically;
3. inconsistent/breaking exports -> the gateway fails closed until the compatibility issue is understood.
