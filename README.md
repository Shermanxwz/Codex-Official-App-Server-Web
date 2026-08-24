# Codex App Server Web

[简体中文](README.zh-CN.md)

A bilingual, self-hosted browser client for the **official OpenAI Codex App Server protocol**.

The project intentionally does not implement an agent runtime. It does not scrape terminal output, call private ChatGPT endpoints, read Codex credentials directly, patch Codex binaries, or own Codex configuration. Browser actions are translated into methods present in the JSON Schema exported by the installed official `codex app-server`.

## Contract

- Official `codex app-server` only.
- Production transport: JSONL over local `stdio`.
- Stable API coverage is schema-driven: every method exported in `ClientRequest.json` and `ClientNotification.json` is admitted automatically.
- Server requests and notifications are discovered from the matching official schemas and forwarded to the browser.
- Experimental APIs are opt-in with `CWEB_EXPERIMENTAL=1`; they are excluded from the stable archive contract.
- No direct reads/writes of Codex auth/config/session files by this project.
- No Codex install, update, upgrade, or process-wide kill feature.
- Project state lives under XDG config/state paths, never under `CODEX_HOME`.
- Chinese and English UI are first-class and can be switched at runtime.

## Architecture

```text
Browser
  | HTTPS / same-origin HTTP + SSE
  v
Codex App Server Web
  | official schema-gated JSON-RPC
  | stdio JSONL
  v
codex app-server
  v
Official Codex runtime / account / workspace
```

The gateway generates fresh official schemas on startup:

```bash
codex app-server generate-json-schema --out <state-dir>/schema-stable
```

The installed Codex version therefore defines the accepted protocol surface. Unknown methods are rejected before reaching Codex.

## UI

The normal interface is intentionally simple: thread list, conversation timeline, streaming events, approvals, send/stop, and bilingual navigation. A separate **Official APIs** drawer exposes the complete schema-derived surface. Known user-facing flows receive native UI; less-common stable methods remain available through a schema-backed JSON form so new upstream stable APIs are usable before a dedicated screen is added.

## Requirements

- Linux or another OS supported by the official Codex CLI.
- Node.js 22.12+.
- A working official `codex` CLI.
- For real work, Codex should already be signed in using the normal official flow.

There are **zero runtime npm dependencies**.

## Run locally

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

Open `http://127.0.0.1:4173` and enter the token.

For local development only:

```bash
npm run dev
```

`dev` disables application authentication and therefore remains loopback-only.

## Linux user-service installation

```bash
./scripts/install-linux.sh
```

The installer writes only project-owned files:

- `~/.config/codex-app-server-web/env`
- `~/.config/systemd/user/codex-app-server-web.service`
- `~/.local/state/codex-app-server-web/`

It does **not** modify the Codex installation or Codex service. The generated service binds to `127.0.0.1` by default. Put it behind Tailscale, an authenticated HTTPS reverse proxy, or another trusted private access layer instead of directly publishing the port.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CWEB_HOST` | `127.0.0.1` | HTTP bind host |
| `CWEB_PORT` | `4173` | HTTP port |
| `CWEB_CODEX_BIN` | `codex` | Official Codex executable |
| `CWEB_WORKSPACE` | process cwd | Initial working directory |
| `CWEB_REQUIRE_AUTH` | `1` | Fail-closed app authentication |
| `CWEB_TOKEN` | empty | Required when auth is enabled |
| `CWEB_PUBLIC_ORIGIN` | empty | Exact public origin for reverse-proxy deployments |
| `CWEB_EXPERIMENTAL` | `0` | Opt into official experimental schema/API capability |
| `CWEB_STATE_DIR` | XDG state path | Project-owned schema/cache state |
| `CWEB_SCHEMA_REFRESH` | `1` | Regenerate official schema at startup |
| `CWEB_RPC_TIMEOUT_MS` | `600000` | Per-request upper bound |

## Stable vs experimental

The archive contract is **Stable-only**. Experimental methods can be enabled for testing, but their backwards compatibility is controlled by upstream and is not part of the sealed compatibility promise.

## Checks and seals

```bash
npm test
npm run check
npm run seal:core
npm run seal
```

`seal:core` validates source invariants and compatibility with the currently installed official schema. `seal` additionally starts the official App Server and verifies signed-in account/model/thread access through official RPC before printing `ARCHIVE_READY`.

See [Production Seal](docs/PRODUCTION_SEAL.md), [Architecture](ARCHITECTURE.md), and [Security](SECURITY.md).

## Relationship to other Codex clients

This project is an independent client for a public OpenAI Codex interface. It is not affiliated with or endorsed by OpenAI. It is designed to coexist with other clients by owning only the App Server child process it starts. It never uses `pkill`/`killall` or attempts to manage unrelated Codex processes.

Concurrent Codex clients can still edit the same workspace or invoke official config-changing APIs at the same time. Those are normal shared-state semantics of Codex and the filesystem, not hidden mutations by this gateway.
