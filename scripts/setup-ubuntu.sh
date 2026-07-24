#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Updating apt packages"
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg build-essential git

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Node version: $(node -v)"
echo "==> npm version: $(npm -v)"

echo "==> Installing npm dependencies"
npm install

echo "==> Installing Playwright Chromium and system dependencies"
npx playwright install --with-deps chromium

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Created .env from .env.example"
  echo "    Fill OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID before running."
else
  echo "==> .env already exists, leaving it unchanged"
fi

mkdir -p logs output data

echo "==> Setup complete"
echo "Next steps:"
echo "  1. Edit .env"
echo "  2. Test scrape: npm run scrape:btc"
echo "  3. Test once:   npm run run:once"
echo "  4. Start bot:   npm start"
echo "  Or install systemd: sudo ./scripts/install-systemd.sh"
