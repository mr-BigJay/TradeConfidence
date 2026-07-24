#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/coinex-ai-bot}"
SERVICE_USER="${SERVICE_USER:-coinexbot}"
SERVICE_FILE="$ROOT_DIR/deploy/coinex-ai-bot.service"
NODE_BIN="$(command -v node)"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing .env in project root. Copy .env.example and fill the keys first."
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is not installed. Run ./scripts/setup-ubuntu.sh first."
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> Creating system user: $SERVICE_USER"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Syncing project to $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'logs' \
  --exclude 'output' \
  --exclude 'data' \
  --exclude 'ms-playwright' \
  "$ROOT_DIR/" "$APP_DIR/"

mkdir -p "$APP_DIR/logs" "$APP_DIR/output" "$APP_DIR/data" "$APP_DIR/ms-playwright"
cp "$ROOT_DIR/.env" "$APP_DIR/.env"

echo "==> Installing dependencies in $APP_DIR"
cd "$APP_DIR"
npm install --omit=dev

echo "==> Installing Playwright Chromium system packages"
npx playwright install-deps chromium

echo "==> Installing Playwright Chromium browser files"
PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/ms-playwright" npx playwright install chromium

chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

TMP_SERVICE="$(mktemp)"
sed \
  -e "s|/opt/coinex-ai-bot|$APP_DIR|g" \
  -e "s|/usr/bin/node|$NODE_BIN|g" \
  "$SERVICE_FILE" > "$TMP_SERVICE"

awk -v user="$SERVICE_USER" '
  BEGIN { inserted = 0 }
  /^\[Service\]$/ && inserted == 0 {
    print
    print "User=" user
    print "Group=" user
    inserted = 1
    next
  }
  { print }
' "$TMP_SERVICE" > /etc/systemd/system/coinex-ai-bot.service

rm -f "$TMP_SERVICE"

systemctl daemon-reload
systemctl enable coinex-ai-bot
systemctl restart coinex-ai-bot

echo "==> Service installed and started"
systemctl --no-pager --full status coinex-ai-bot || true
echo
echo "Useful commands:"
echo "  sudo systemctl status coinex-ai-bot"
echo "  sudo journalctl -u coinex-ai-bot -f"
echo "  sudo systemctl restart coinex-ai-bot"
