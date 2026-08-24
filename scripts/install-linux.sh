#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/codex-app-server-web"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/codex-app-server-web"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_FILE="$CONFIG_DIR/env"
SERVICE_FILE="$SERVICE_DIR/codex-app-server-web.service"

command -v node >/dev/null || { echo "Node.js 22.12+ is required" >&2; exit 1; }
command -v codex >/dev/null || { echo "A working official codex CLI is required" >&2; exit 1; }
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); if(a<22 || (a===22&&b<12)) process.exit(1)' || { echo "Node.js 22.12+ is required" >&2; exit 1; }

umask 077
mkdir -p "$CONFIG_DIR" "$STATE_DIR" "$SERVICE_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
  cat > "$ENV_FILE" <<ENV
CWEB_REQUIRE_AUTH=1
CWEB_TOKEN=$TOKEN
CWEB_HOST=127.0.0.1
CWEB_PORT=4173
CWEB_WORKSPACE=$HOME
CWEB_EXPERIMENTAL=0
ENV
  chmod 600 "$ENV_FILE"
  echo "Generated access token (save it now): $TOKEN"
else
  echo "Keeping existing $ENV_FILE"
fi

sed -e "s|__PROJECT_ROOT__|$ROOT|g" "$ROOT/deploy/codex-app-server-web.service" > "$SERVICE_FILE"
chmod 600 "$SERVICE_FILE"
systemctl --user daemon-reload
systemctl --user enable --now codex-app-server-web.service

echo "Installed. Keep the service on 127.0.0.1 and expose it through Tailscale/HTTPS/reverse proxy."
echo "Status: systemctl --user status codex-app-server-web.service"
