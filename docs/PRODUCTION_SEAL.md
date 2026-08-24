# Production Seal / 生产封存

The repository distinguishes a portable core seal from a live target-machine seal.

## CORE_SEALED

Run on any machine with the official Codex CLI installed:

```bash
npm test
npm run check
npm run seal:core
```

This proves:

- zero runtime npm dependencies;
- source invariants and non-interference checks pass;
- the installed official Codex can export the stable JSON schemas;
- stable request/server-request sets are non-empty;
- the exact Codex version and schema SHA-256 are recorded.

## ARCHIVE_READY

On the real Linux host, using the same operating-system account that normally runs Codex:

```bash
npm run seal
```

The production seal additionally starts **its own** official App Server and checks through official RPC that:

- `account/read` returns a usable account;
- `model/list` succeeds;
- `thread/list` succeeds;
- initialization completes over stdio.

Only then does the script print:

```text
ARCHIVE_READY
```

## Non-interference check with another Codex client

For deployments that also run another Codex client, the final operational check should run one harmless turn in each client in separate test workspaces, then restart/stop Codex App Server Web and confirm the other client continues. No code in this project is allowed to kill or reconfigure the other client's App Server.

## 上线原则

- Stable-only：`CWEB_EXPERIMENTAL=0`
- Auth on：`CWEB_REQUIRE_AUTH=1`
- 默认 loopback：`CWEB_HOST=127.0.0.1`
- 远程访问必须有可信 HTTPS/VPN/SSH 层
- 不把 token 写进 shell history 或日志
- 每次升级官方 Codex 后重新执行 `npm run seal`
