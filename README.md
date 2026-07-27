# BTC Advanced Market Intelligence Engine

Daily Trading Plan engine (03:30 Asia/Tehran) that combines:

- **CoinEx** → narrative / scenarios / levels (kept)
- **Binance Futures** → market truth (funding, OI, CVD, L/S, depth…)
- **Deribit Options** → PCR, Max Pain, IV, dealer gamma proxy
- **Chart Intelligence** → multi-TF TA (1D/4H/1H/15M/5M): structure, S/R, EMA/RSI/MACD/VWAP, patterns, Fib, liquidity
- **Bitunix** → execution venue only (price/funding/OI/orderbook divergence)

Entry/TP/SL only when **Market + Technical + Risk** confirmations pass. Pattern alone never creates a trade.

Output each morning: Bias, Entry, TP1-3, SL, RR, Confidence, validation status, risk warnings.

Intraday hourly updates evaluate the **same locked plan** (`Active` / `Weakening` / `Invalidated`) without inventing new Entry/SL/TP.

Auto-trading API is not connected yet.

## Stack

- Node.js
- Playwright Chromium
- OpenAI API
- Telegram Bot API
- SQLite
- Winston
- dotenv
- node-cron

## Project structure

```text
config/
  config.js
playwright/
  scraper.js
services/
  openai.js
  telegram.js
  pipeline.js
database/
  db.js
prompts/
  analysis.txt
logs/
output/
main.js
package.json
```

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Fill `.env`.

For ArvanCloud AIaaS (recommended in Iran):

```env
OPENAI_API_KEY=apikey_value_without_prefix
OPENAI_MODEL=GPT-4.1-Mini
OPENAI_BASE_URL=https://arvancloud.ai.ir/gateway/models/GPT-4.1-Mini/YOUR_ENDPOINT_ID
OPENAI_AUTH_SCHEME=apikey
OPENAI_JSON_MODE=false

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

CHECK_INTERVAL_MINUTES=60
COINEX_SYMBOLS=BTCUSDT
HEADLESS=true
```

`OPENAI_BASE_URL` must be the Endpoint from Arvan panel, without `/chat/completions`.
`OPENAI_API_KEY` must be the Machine User key (only the token part).

## Ubuntu 24 VPS setup (Germany / EU recommended)

CoinEx may block some cloud IP regions. Use a VPS where the Futures page
loads normally (for example Germany).

```bash
git clone https://github.com/mr-BigJay/TradeConfidence.git
cd TradeConfidence
git checkout cursor/coinex-ai-research-bot-879f
chmod +x scripts/*.sh
./scripts/setup-ubuntu.sh
nano .env
```

Create today's daily setup once:

```bash
npm run run:daily
```

Force recreate today's setup:

```bash
npm run run:daily:force
```

Run one intraday status update:

```bash
npm run run:intraday
```

Install as a systemd service:

```bash
sudo ./scripts/install-systemd.sh
```

Service commands:

```bash
sudo systemctl status coinex-ai-bot
sudo journalctl -u coinex-ai-bot -f
sudo systemctl restart coinex-ai-bot
```

## Schedule

```bash
npm start
```

- Daily setup cron: `DAILY_SETUP_CRON=30 3 * * *` (Iran timezone)
- Intraday cron: every `CHECK_INTERVAL_MINUTES` (default 60)

On boot, if today's setup is missing it will be created, then one intraday check runs.

Diagnose:

```bash
npm run doctor
sudo journalctl -u coinex-ai-bot -n 100 --no-pager
```

## Card image mode

Cards are generated **on the server** (HTML → PNG via Playwright). This is the
default and recommended production mode:

```env
CARD_MODE=html
```

Optional modes (not used in production by default):
- `api` : Arvan/OpenAI image model
- `auto` : try API first, fall back to HTML

Each successful analysis renders a Persian dashboard card and sends it to
Telegram via `sendPhoto`, with the deep analysis text. If image rendering fails,
the bot falls back to text-only Telegram delivery.

## Output

Raw scrape results are saved in `output/*.json`:

```json
{
  "symbol": "BTCUSDT",
  "datetime": "2026-07-24T10:50:00.000Z",
  "url": "https://www.coinex.com/futures/BTC-USDT",
  "text": "CoinEx AI Research Text..."
}
```

SQLite stores content hashes, raw AI Research text, analysis JSON, and event
logs. Winston writes runtime logs to `logs/app.log` and errors to
`logs/error.log`.
