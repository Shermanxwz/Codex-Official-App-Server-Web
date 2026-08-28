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
UNIT_NAME="codex-app-server-web.service"
OFFICIAL_UNIT_NAME="codex-official-app-server.service"
# Preserve the environment file already used by a running installation. This
# matters when the desktop launcher supplies a private XDG_CONFIG_HOME but a
# later shell invocation does not: silently switching files would rotate the
# Web token and lock the operator out.
ACTIVE_ENV_FILE="$(systemctl --user show "$UNIT_NAME" -p EnvironmentFiles --value 2>/dev/null || true)"
ACTIVE_ENV_FILE="${ACTIVE_ENV_FILE%% *}"
if [[ -f "$ACTIVE_ENV_FILE" ]]; then CONFIG_DIR="$(dirname "$ACTIVE_ENV_FILE")"; fi
ENV_FILE="$CONFIG_DIR/env"
SERVICE_FILE="$SERVICE_DIR/codex-app-server-web.service"
OFFICIAL_ENV_FILE="$CONFIG_DIR/codex-official-app-server.env"
OFFICIAL_SERVICE_FILE="$SERVICE_DIR/codex-official-app-server.service"
NODE_BIN="$(command -v node || true)"
CODEX_BIN_DISCOVERED="$(command -v codex || true)"
CODEX_BIN="${CODEX_BIN_OVERRIDE:-$CODEX_BIN_DISCOVERED}"

[[ -n "$NODE_BIN" ]] || { echo "Node.js 22.12+ is required" >&2; exit 1; }
[[ -n "$CODEX_BIN" ]] || { echo "A working official codex CLI is required" >&2; exit 1; }
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22&&b<12)) process.exit(1)' || { echo "Node.js 22.12+ is required" >&2; exit 1; }

for value in "$ROOT" "$NODE_BIN" "$CODEX_BIN" "$HOME" "$CONFIG_DIR" "$STATE_DIR" "$SERVICE_DIR" "$ENV_FILE" "$SERVICE_FILE" "$OFFICIAL_ENV_FILE" "$OFFICIAL_SERVICE_FILE"; do
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo "Paths containing newlines are unsupported" >&2; exit 1; }
done

quote_env() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

upsert_env() {
  local name="$1" value="$2"
  ENV_FILE="$ENV_FILE" ENV_NAME="$name" ENV_VALUE="$value" "$NODE_BIN" <<'NODE'
const fs=require('node:fs');
const file=process.env.ENV_FILE, name=process.env.ENV_NAME, value=JSON.stringify(process.env.ENV_VALUE);
if(!/^CWEB_[A-Z0-9_]+$/.test(name))throw new Error('Refusing invalid service environment key');
const lines=fs.readFileSync(file,'utf8').split(/\n/);
while(lines.length&&lines.at(-1)==='')lines.pop();
let replaced=false;
const next=lines.map(line=>{
  if(!line.startsWith(`${name}=`))return line;
  if(replaced)return null;
  replaced=true;
  return `${name}=${value}`;
}).filter(line=>line!==null);
if(!replaced)next.push(`${name}=${value}`);
const temporary=`${file}.tmp-${process.pid}`;
fs.writeFileSync(temporary,`${next.join('\n')}\n`,{mode:0o600});
fs.renameSync(temporary,file);
fs.chmodSync(file,0o600);
NODE
}

if [[ -n "${CWEB_PUBLIC_ORIGIN:-}" ]]; then
  "$NODE_BIN" -e 'const value=process.argv[1];let parsed;try{parsed=new URL(value)}catch{}if(!parsed||value!==parsed.origin||!["http:","https:"].includes(parsed.protocol)||parsed.username||parsed.password)process.exit(1)' "$CWEB_PUBLIC_ORIGIN" || {
    echo "CWEB_PUBLIC_ORIGIN must be a canonical exact origin such as https://codex.example.com" >&2
    exit 1
  }
fi

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
    printf 'CWEB_CODEX_TRANSPORT=websocket\n'
    printf 'CWEB_CODEX_SERVER_URL=ws://127.0.0.1:43999\n'
    printf 'CWEB_EXPERIMENTAL=1\n'
    if [[ -n "${CWEB_PUBLIC_ORIGIN:-}" ]]; then printf 'CWEB_PUBLIC_ORIGIN=%s\n' "$(quote_env "$CWEB_PUBLIC_ORIGIN")"; fi
    printf 'CWEB_STATE_DIR=%s\n' "$(quote_env "$STATE_DIR")"
    printf 'CWEB_CONFIG_DIR=%s\n' "$(quote_env "$CONFIG_DIR")"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Generated a private access token in $ENV_FILE (mode 600); do not copy it into logs or shell history."
else
  chmod 600 "$ENV_FILE"
  if [[ -n "${CODEX_BIN_OVERRIDE:-}" ]]; then
    upsert_env CWEB_CODEX_BIN "$CODEX_BIN"
  elif ! grep -q '^CWEB_CODEX_BIN=' "$ENV_FILE"; then
    printf 'CWEB_CODEX_BIN=%s\n' "$(quote_env "$CODEX_BIN")" >> "$ENV_FILE"
  fi
  if [[ -n "${CWEB_PUBLIC_ORIGIN:-}" ]]; then upsert_env CWEB_PUBLIC_ORIGIN "$CWEB_PUBLIC_ORIGIN"; fi
  if ! grep -q '^CWEB_CODEX_TRANSPORT=' "$ENV_FILE"; then
    printf 'CWEB_CODEX_TRANSPORT=websocket\n' >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_CODEX_SERVER_URL=' "$ENV_FILE"; then
    printf 'CWEB_CODEX_SERVER_URL=ws://127.0.0.1:43999\n' >> "$ENV_FILE"
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
    printf 'CWEB_EXPERIMENTAL=1\n' >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_STATE_DIR=' "$ENV_FILE"; then
    printf 'CWEB_STATE_DIR=%s\n' "$(quote_env "$STATE_DIR")" >> "$ENV_FILE"
  fi
  if ! grep -q '^CWEB_CONFIG_DIR=' "$ENV_FILE"; then
    printf 'CWEB_CONFIG_DIR=%s\n' "$(quote_env "$CONFIG_DIR")" >> "$ENV_FILE"
  fi
  echo "Keeping existing $ENV_FILE"
fi
# The official App Server is deliberately a separate, project-supervised
# process. It receives only the network variables needed by the installed
# Codex runtime; the Web session token and all CWEB_* settings stay private to
# the gateway. Keeping this process alive is what lets a gateway restart
# reconnect to an in-flight official Turn instead of terminating it.
# A user systemd manager does not necessarily inherit the invoking shell's
# proxy environment. Explicit current values replace older ones; absent values
# preserve the last known service configuration. The official environment is
# rebuilt from the proxy allow-list only, so CWEB_TOKEN and other gateway
# settings can never cross this boundary.
"$NODE_BIN" "$ROOT/scripts/proxy-env.mjs" "$ENV_FILE" "$OFFICIAL_ENV_FILE"

CODEX_SERVER_URL="$(sed -n 's/^CWEB_CODEX_SERVER_URL=//p' "$ENV_FILE" | head -n 1)"
CODEX_SERVER_URL="${CODEX_SERVER_URL#\"}"
CODEX_SERVER_URL="${CODEX_SERVER_URL%\"}"
[[ -n "$CODEX_SERVER_URL" ]] || CODEX_SERVER_URL="ws://127.0.0.1:43999"
CODEX_SERVER_PORT="$($NODE_BIN -e 'const u=new URL(process.argv[1]); process.stdout.write(String(u.port || (u.protocol === "wss:" ? 443 : 80)))' "$CODEX_SERVER_URL")"
[[ "$CODEX_SERVER_PORT" =~ ^[0-9]+$ ]] || { echo "Invalid CWEB_CODEX_SERVER_URL port" >&2; exit 2; }

ROOT="$ROOT" NODE_BIN="$NODE_BIN" NODE_BIN_DIR="$(dirname "$NODE_BIN")" ENV_FILE="$ENV_FILE" TEMPLATE="$ROOT/deploy/codex-app-server-web.service" OUTPUT="$SERVICE_FILE" "$NODE_BIN" <<'NODE'
const fs=require('node:fs');
const template=fs.readFileSync(process.env.TEMPLATE,'utf8');
const quoteUnit=(value)=>String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%');
const pathUnit=(value)=>String(value).replaceAll('\\','\\\\').replaceAll('%','%%').replaceAll(' ','\\x20').replaceAll('\t','\\x09').replaceAll('"','\\x22');
const output=template
  .replaceAll('__PROJECT_ROOT__',quoteUnit(process.env.ROOT))
  .replaceAll('__NODE_BIN__',quoteUnit(process.env.NODE_BIN))
  .replaceAll('__NODE_BIN_DIR__',pathUnit(process.env.NODE_BIN_DIR))
  .replaceAll('__ENV_FILE__',pathUnit(process.env.ENV_FILE));
if(output.includes('__PROJECT_ROOT__') || output.includes('__NODE_BIN__') || output.includes('__NODE_BIN_DIR__') || output.includes('__ENV_FILE__')) throw new Error('Unresolved systemd service placeholder');
fs.writeFileSync(process.env.OUTPUT,output,{mode:0o600});
NODE
chmod 600 "$SERVICE_FILE"

ROOT="$ROOT" NODE_BIN_DIR="$(dirname "$NODE_BIN")" CODEX_BIN="$CODEX_BIN" WORKSPACE="$HOME" OFFICIAL_ENV_FILE="$OFFICIAL_ENV_FILE" LISTEN_URL="$CODEX_SERVER_URL" TEMPLATE="$ROOT/deploy/codex-official-app-server.service" OUTPUT="$OFFICIAL_SERVICE_FILE" "$NODE_BIN" <<'NODE'
const fs=require('node:fs');
const template=fs.readFileSync(process.env.TEMPLATE,'utf8');
const quoteUnit=(value)=>String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%');
const pathUnit=(value)=>String(value).replaceAll('\\','\\\\').replaceAll('%','%%').replaceAll(' ','\\x20').replaceAll('\t','\\x09').replaceAll('"','\\x22');
const output=template
  .replaceAll('__WORKSPACE__',pathUnit(process.env.WORKSPACE))
  .replaceAll('__NODE_BIN_DIR__',pathUnit(process.env.NODE_BIN_DIR))
  .replaceAll('__CODEX_BIN__',quoteUnit(process.env.CODEX_BIN))
  .replaceAll('__ENV_FILE__',pathUnit(process.env.OFFICIAL_ENV_FILE))
  .replaceAll('__LISTEN_URL__',quoteUnit(process.env.LISTEN_URL));
if(output.includes('__WORKSPACE__') || output.includes('__NODE_BIN_DIR__') || output.includes('__CODEX_BIN__') || output.includes('__ENV_FILE__') || output.includes('__LISTEN_URL__')) throw new Error('Unresolved official service placeholder');
fs.writeFileSync(process.env.OUTPUT,output,{mode:0o600});
NODE
chmod 600 "$OFFICIAL_SERVICE_FILE"
systemctl --user daemon-reload
systemctl --user enable "$OFFICIAL_UNIT_NAME"
systemctl --user restart "$OFFICIAL_UNIT_NAME"
for _ in {1..80}; do
  if curl -fsS "http://127.0.0.1:${CODEX_SERVER_PORT}/readyz" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
systemctl --user is-active "$OFFICIAL_UNIT_NAME" >/dev/null
curl -fsS "http://127.0.0.1:${CODEX_SERVER_PORT}/readyz" >/dev/null
systemctl --user enable "$UNIT_NAME"
systemctl --user restart "$UNIT_NAME"
LOADED_SERVICE="$(systemctl --user show "$UNIT_NAME" -p FragmentPath --value)"
[[ "$LOADED_SERVICE" == "$SERVICE_FILE" ]] || { echo "systemd loaded unexpected unit path: $LOADED_SERVICE" >&2; exit 1; }
systemctl --user is-enabled "$UNIT_NAME" >/dev/null
systemctl --user is-active "$UNIT_NAME" >/dev/null
LOADED_OFFICIAL_SERVICE="$(systemctl --user show "$OFFICIAL_UNIT_NAME" -p FragmentPath --value)"
[[ "$LOADED_OFFICIAL_SERVICE" == "$OFFICIAL_SERVICE_FILE" ]] || { echo "systemd loaded unexpected official unit path: $LOADED_OFFICIAL_SERVICE" >&2; exit 1; }

echo "Installed persistent official App Server plus Web gateway. Keep both services on 127.0.0.1 and expose Web only through Tailscale/HTTPS/reverse proxy."
echo "Status: systemctl --user status $UNIT_NAME"
echo "Readiness: curl -fsS http://127.0.0.1:4173/readyz"
