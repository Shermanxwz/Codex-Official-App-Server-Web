# Production Seal / 生产封存

The repository distinguishes repository integrity, a portable core seal, and the final live target-host seal.

## 1. Repository integrity

```bash
npm ci --ignore-scripts
npm run manifest:verify
npm test
npm run check
```

This verifies the checked-in source manifest, zero runtime npm dependencies, static non-interference/security invariants, protocol-gate architecture and local regression suite.

## 2. `CORE_SEALED`

Run on any machine with an official Codex CLI installed:

```bash
npm run seal:core
```

The core seal additionally proves:

- the installed exact Codex version can export both stable JSON Schema and TypeScript protocol definitions;
- for all four protocol directions, every JSON wire method is covered by the TypeScript export; TypeScript-only legacy/type exports are recorded but do not expand the wire allow-list;
- required core stable methods are present;
- stable server-request coverage is non-empty;
- exact Codex version, dual-export digest and JSON→TypeScript coverage, source digest and method counts are recorded.

The script prints:

```text
CORE_SEALED
```

## 3. `ARCHIVE_READY`

Run this on the **real Linux host**, as the same OS account that normally uses Codex:

```bash
npm run seal
```

This first repeats the core seal, then starts its **own** real official App Server and verifies through official RPC only:

- initialization over `stdio`;
- `account/read` returns a usable configured account;
- `model/list` succeeds;
- `thread/list` succeeds;
- `thread/loaded/list` succeeds when that method exists in the installed stable schema.

No mutation RPC is required by the seal. The production manifest records platform, exact Codex version, schema digest, stable method counts and security invariants. Only after all checks pass does it print:

```text
ARCHIVE_READY
```

Hosted CI cannot substitute for this step because it cannot prove the user's actual signed-in account, filesystem/runtime environment or target-host coexistence.

## 4. Coexistence / non-interference test

When the target host also runs another Codex client:

1. use two disposable, separate workspaces;
2. start a harmless turn from the other client;
3. start a harmless turn from Official Codex App Server Web;
4. restart/stop the Web service while the other client remains active;
5. confirm the other client's task/process remains alive;
6. start the Web service again and confirm it creates only its own fresh App Server child.

This proves process-lifecycle isolation. It does **not** claim that two independent Codex clients can safely modify the exact same files simultaneously; ordinary filesystem/config shared-state concurrency still applies.

## 5. Sealed deployment policy

- `CWEB_EXPERIMENTAL=0`
- `CWEB_REQUIRE_AUTH=1`
- preferably `CWEB_HOST=127.0.0.1`
- remote access only through trusted HTTPS/VPN/SSH layer
- do not log or place `CWEB_TOKEN` in shell history
- regenerate/verify source manifest after intentional source changes
- rerun `npm run seal` after an official Codex upgrade

`ARCHIVE_READY` proves the gateway's source contract, official protocol exports, and real target-host RPC calls. It does not claim byte-for-byte immutability of official Codex's own `~/.codex` authentication/session state: the official runtime or another concurrently running Codex client may refresh or journal its own state. The gateway itself never owns or directly writes those files.

## 6. CI baseline

Required CI validates a fixed, known-good official Codex release for reproducibility. A separate `continue-on-error` latest-version job detects future protocol drift early without invalidating an already sealed baseline merely because upstream published a new release.
