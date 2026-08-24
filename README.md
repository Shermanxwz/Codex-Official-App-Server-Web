# Official Codex App Server Web

[简体中文](README.zh-CN.md)

A bilingual, self-hosted Web client for the **official OpenAI Codex App Server protocol**. The project is intentionally a client, not a replacement runtime: it does not scrape terminal output, call private ChatGPT backends, read Codex credentials directly, patch Codex binaries, or own Codex configuration.

## Archive contract

- **Official App Server only.** Production uses local JSONL over `stdio`.
- **Stable protocol coverage is set-based, not hand-maintained.** At startup the installed official `codex` binary exports both JSON Schema and TypeScript protocol definitions. Every JSON wire method must also be present in the TypeScript export or startup fails closed. TypeScript-only legacy/type exports are recorded but are not treated as current invocable wire methods.
- **100% stable wire/API method coverage.** Every stable method exported by `ClientRequest`/`ClientNotification` is implemented either as a gateway-managed lifecycle operation (`initialize` / `initialized`) or is available through the schema-gated Official APIs surface. Server requests and notifications are also checked against their official exports before reaching the browser.
- **Native core UX.** Threads, history, resume, turns, streaming, interrupt, approvals, models and supported reasoning effort are first-class UI flows. Less common stable methods remain available through the official-schema form.
- **Experimental is opt-in** with `CWEB_EXPERIMENTAL=1` and is outside the archive compatibility promise.
- **Never bypass Codex.** This project does not directly read/write Codex auth/config/session files. If a user invokes an official state-changing RPC, Codex itself owns that mutation.
- **Process and secret isolation.** The service owns only the App Server child it launches. All `CWEB_*` secrets are stripped from Codex subprocess environments. No `pkill`, `killall`, installer or upgrader exists in the product.
- **Bounded operation.** RPC concurrency, stdin buffering, JSONL line size, browser event size and SSE slow-client buffering are bounded. Unexpected App Server exit clears stale approvals and is recovered with bounded exponential restart.
- **Reconnect correctness.** Browser reconnect performs authoritative resynchronization and never automatically replays uncertain writes.
- **Project state stays outside `CODEX_HOME`** under XDG config/state paths.
- **Chinese and English are first-class UI languages.**

See [ARCHIVE_CONTRACT.md](docs/ARCHIVE_CONTRACT.md) for the precise guarantee and exclusions.

## Architecture

```text
Browser
  | same-origin HTTP + SSE
  v
Official Codex App Server Web
  | bidirectional official-schema gate
  | JSONL over stdio
  v
codex app-server
  v
Official Codex runtime / account / workspace
```

The gateway regenerates both official export forms from the installed Codex version:

```bash
codex app-server generate-json-schema --out <state-dir>/schema-stable
codex app-server generate-ts          --out <state-dir>/schema-stable
```

The exact Codex version and a digest of those exports are recorded in the schema cache manifest. With schema refresh disabled, a version or digest mismatch is fatal rather than silently using stale protocol data.

## Web UI

The normal interface stays intentionally simple:

- thread list and archived history access;
- thread read/resume before continuing stored work;
- conversation timeline and live notifications;
- model selector plus only the reasoning efforts supported by that selected model;
- send, steer-compatible official surface, interrupt, command/file/permission approvals;
- mobile navigation and Chinese/English switching;
- reconnect/resync status;
- a complete **Official APIs** panel for the remaining stable protocol surface.

Lifecycle handshake methods are implemented automatically by the gateway and are shown as gateway-managed rather than exposed as unsafe duplicate handshake buttons.

## Requirements

- Linux or another OS supported by the official Codex CLI.
- Node.js 22.12+.
- A working official `codex` CLI.
- For real use, Codex should already be signed in through the normal official flow.

There are **zero runtime npm dependencies**.

## Run locally

```bash
export CWEB_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
export CWEB_WORKSPACE="$HOME"
npm start
```

Open `http://127.0.0.1:4173` and enter the token.

Development-only mode:

```bash
npm run dev
```

`dev` disables application authentication and remains loopback-only.

## Linux user-service installation

```bash
./scripts/install-linux.sh
```

The installer resolves and records the exact current `node` and `codex` executables and writes only project-owned files:

- `$XDG_CONFIG_HOME/codex-app-server-web/env` (default `~/.config/codex-app-server-web/env`)
- `~/.config/systemd/user/codex-app-server-web.service`
- `$XDG_STATE_HOME/codex-app-server-web/` (default `~/.local/state/codex-app-server-web/`)

The systemd user unit always stays in the standard `~/.config/systemd/user/` search path, while its `EnvironmentFile` points at the selected XDG config directory. The generated access token is stored mode `0600` and is not printed by the installer.

The service uses `UMask=0077`, `KillMode=control-group`, bounded shutdown, auth-on defaults, and does not restart-loop on fatal configuration/schema errors. It does **not** modify Codex installation/configuration or another Codex service.

Keep the app on loopback and use Tailscale, an authenticated HTTPS reverse proxy, or an SSH tunnel for remote access. Do not publish the raw HTTP port to the public Internet.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CWEB_HOST` | `127.0.0.1` | HTTP bind host |
| `CWEB_PORT` | `4173` | HTTP port |
| `CWEB_CODEX_BIN` | `codex` | Official Codex executable |
| `CWEB_WORKSPACE` | process cwd | Initial working directory |
| `CWEB_REQUIRE_AUTH` | `1` | Fail-closed app authentication |
| `CWEB_TOKEN` | empty | Required when auth is enabled |
| `CWEB_PUBLIC_ORIGIN` | empty | Exact trusted public origin for proxy deployments |
| `CWEB_EXPERIMENTAL` | `0` | Opt into upstream experimental schema/API |
| `CWEB_STATE_DIR` | XDG state path | Project-owned schema/cache state |
| `CWEB_SCHEMA_REFRESH` | `1` | Regenerate official exports at startup |
| `CWEB_RPC_TIMEOUT_MS` | `600000` | Per-RPC upper bound |
| `CWEB_MAX_PENDING_RPC` | `64` | Maximum concurrent pending RPCs |
| `CWEB_MAX_STDIN_BUFFER` | `4194304` | Maximum queued App Server stdin bytes |
| `CWEB_MAX_JSONL_LINE` | `33554432` | Maximum App Server JSONL record bytes |
| `CWEB_EVENT_MAX_BYTES` | `16777216` | Maximum browser event frame bytes |
| `CWEB_SSE_MAX_BUFFER` | `2097152` | Slow-client SSE buffer limit |

Process probes:

```text
GET /healthz   process health
GET /readyz    official App Server readiness
```

## Reproducible checks and seals

The repository pins a required, known-good Codex baseline in CI and separately runs an advisory latest-version compatibility job. GitHub Actions are referenced by exact commit SHA.

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
npm run seal:core
npm run seal
```

- `manifest:verify` proves the checked-in source manifest matches the tree.
- `seal:core` proves source invariants plus dual official-export coverage against the currently installed Codex.
- `seal` additionally launches its own real official App Server on the target host and verifies `account/read`, `model/list`, `thread/list`, and `thread/loaded/list` (when exported) through official RPC. Only then does it print `ARCHIVE_READY`.

See [Production Seal](docs/PRODUCTION_SEAL.md), [Architecture](ARCHITECTURE.md), [Security](SECURITY.md), and [Upstream validation](docs/UPSTREAM_VALIDATION.md).

## Relationship to other Codex clients

This is an independent client for an official OpenAI Codex interface; it is not affiliated with or endorsed by OpenAI. It owns only the App Server child it starts and is designed to coexist with other Codex clients.

Multiple clients may still deliberately act on the same workspace or invoke official global configuration-changing RPCs concurrently. Those are normal shared-state semantics of Codex/the filesystem, not hidden mutations by this gateway. For a sealed deployment that also runs another client, perform the non-interference test documented in the production seal.
