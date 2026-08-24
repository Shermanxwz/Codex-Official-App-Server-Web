#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/codex-app-server-web"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/codex-app-server-web"
# systemd --user has a manager-owned search path. Keep the unit in the
# standard per-user directory even when the invoking desktop app sets a
# private XDG_CONFIG_HOME; the project EnvironmentFile may still live in the
# selected XDG config directory.
SERVICE_DIR="$HOME/.config/systemd/user"
ENV_FILE="$CONFIG_DIR/env"
SERVICE_FILE="$SERVICE_DIR/codex-app-server-web.service"
UNIT_NAME="codex-app-server-web.service"
NODE_BIN="$(command -v node || true)"
CODEX_BIN="$(command -v codex || true)"

[[ -n "$NODE_BIN" ]] || { echo "Node.js 22.12+ is required" >&2; exit 1; }
[[ -n "$CODEX_BIN" ]] || { echo "A working official codex CLI is required" >&2; exit 1; }
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22&&b<12)) process.exit(1)' || { echo "Node.js 22.12+ is required" >&2; exit 1; }

for value in "$ROOT" "$NODE_BIN" "$CODEX_BIN" "$HOME" "$CONFIG_DIR" "$STATE_DIR" "$SERVICE_DIR" "$ENV_FILE" "$SERVICE_FILE"; do
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo "Paths containing newlines are unsupported" >&2; exit 1; }
done

quote_env() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

umask 077
mkdir -p "$CONFIG_DIR" "$STATE_DIR" "$SERVICE_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$("$NODE_BIN" -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
  {
    printf 'CWEB_REQUIRE_AUTH=1\n'
    printf 'CWEB_TOKEN=%s\n' "$(quote_env "$TOKEN")"
    printf 'CWEB_HOST=127.0.0.1\n'
    printf 'CWEB_PORT=4173\n'
    printf 'CWEB_WORKSPACE=%s\n' "$(quote_env "$HOME")"
    printf 'CWEB_CODEX_BIN=%s\n' "$(quote_env "$CODEX_BIN")"
    printf 'CWEB_EXPERIMENTAL=0\n'
    printf 'CWEB_STATE_DIR=%s\n' "$(quote_env "$STATE_DIR")"
    printf 'CWEB_CONFIG_DIR=%s\n' "$(quote_env "$CONFIG_DIR")"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Generated a private access token in $ENV_FILE (mode 600); do not copy it into logs or shell history."
else
  chmod 600 "$ENV_FILE"
  if ! grep -q '^CWEB_CODEX_BIN=' "$ENV_FILE"; then
    printf 'CWEB_CODEX_BIN=%s\n' "$(quote_env "$CODEX_BIN")" >> "$ENV_FILE"
  fi
  if grep -q '^CWEB_REQUIRE_AUTH=' "$ENV_FILE" && ! grep -q '^CWEB_REQUIRE_AUTH=1$' "$ENV_FILE"; then
    echo "Existing $ENV_FILE must keep CWEB_REQUIRE_AUTH=1 for a sealed service" >&2
    exit 1
  fi
  if ! grep -q '^CWEB_REQUIRE_AUTH=' "$ENV_FILE"; then
    printf 'CWEB_REQUIRE_AUTH=1\n' >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_HOST=' "$ENV_FILE"; then
    printf 'CWEB_HOST=127.0.0.1\n' >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_EXPERIMENTAL=' "$ENV_FILE"; then
    printf 'CWEB_EXPERIMENTAL=0\n' >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_STATE_DIR=' "$ENV_FILE"; then
    printf 'CWEB_STATE_DIR=%s\n' "$(quote_env "$STATE_DIR")" >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_CONFIG_DIR=' "$ENV_FILE"; then
    printf 'CWEB_CONFIG_DIR=%s\n' "$(quote_env "$CONFIG_DIR")" >> "$ENV_FILE"
  fi
  echo "Keeping existing $ENV_FILE"
fi
chmod 600 "$ENV_FILE"

ROOT="$ROOT" NODE_BIN="$NODE_BIN" ENV_FILE="$ENV_FILE" TEMPLATE="$ROOT/deploy/codex-app-server-web.service" OUTPUT="$SERVICE_FILE" "$NODE_BIN" <<'NODE'
const fs=require('node:fs');
const template=fs.readFileSync(process.env.TEMPLATE,'utf8');
const quoteUnit=(value)=>String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%');
const pathUnit=(value)=>String(value).replaceAll('\\','\\\\').replaceAll('%','%%').replaceAll(' ','\\x20').replaceAll('\t','\\x09').replaceAll('"','\\x22');
const output=template
  .replaceAll('__PROJECT_ROOT__',quoteUnit(process.env.ROOT))
  .replaceAll('__NODE_BIN__',quoteUnit(process.env.NODE_BIN))
  .replaceAll('__ENV_FILE__',pathUnit(process.env.ENV_FILE));
if(output.includes('__PROJECT_ROOT__') || output.includes('__NODE_BIN__') || output.includes('__ENV_FILE__')) throw new Error('Unresolved systemd service placeholder');
fs.writeFileSync(process.env.OUTPUT,output,{mode:0o600});
NODE
chmod 600 "$SERVICE_FILE"
systemctl --user daemon-reload
systemctl --user enable "$UNIT_NAME"
systemctl --user restart "$UNIT_NAME"
LOADED_SERVICE="$(systemctl --user show "$UNIT_NAME" -p FragmentPath --value)"
[[ "$LOADED_SERVICE" == "$SERVICE_FILE" ]] || { echo "systemd loaded unexpected unit path: $LOADED_SERVICE" >&2; exit 1; }
systemctl --user is-enabled "$UNIT_NAME" >/dev/null
systemctl --user is-active "$UNIT_NAME" >/dev/null

echo "Installed. Keep the service on 127.0.0.1 and expose it through Tailscale/HTTPS/reverse proxy."
echo "Status: systemctl --user status $UNIT_NAME"
echo "Readiness: curl -fsS http://127.0.0.1:4173/readyz"
