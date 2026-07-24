# CoinEx AI Research Automation

Automated Node.js bot that checks the CoinEx Futures AI Research section for
`BTCUSDT`, converts the extracted text into a Persian market status report with
OpenAI, and sends the result to Telegram.

The first version focuses only on CoinEx AI Research for BTC. The architecture is
kept modular so future data sources such as funding rate, open interest,
long/short ratio, liquidation heatmap, order book, and macro data can be added as
separate services.

> The Telegram report is a market-status analysis, not a buy/sell signal.

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

Validate CoinEx access first:

```bash
npm run scrape:btc
```

If scrape works, run the full pipeline once:

```bash
npm run run:once
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

## Run once

Scrape only:

```bash
npm run scrape:btc
```

Full pipeline once:

```bash
npm run run:once
```

## Run scheduled

```bash
npm start
```

The default schedule checks BTC every 60 minutes. If the extracted AI Research
text has not changed since the previous successful scrape, OpenAI and Telegram
are skipped to avoid duplicate messages and unnecessary API cost.

Force a full run even if the text is unchanged:

```bash
npm run run:force
```

> Use `run:force` only for manual testing. The scheduled bot never uses force.
> Normal mode sends Telegram only when CoinEx publishes a new AI Research update.

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
