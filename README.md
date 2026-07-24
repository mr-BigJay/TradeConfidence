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

Fill `.env`:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

CHECK_INTERVAL_MINUTES=30
COINEX_SYMBOLS=BTCUSDT
HEADLESS=true
SCRAPE_TIMEOUT_MS=30000
DATABASE_PATH=./data/coinex-ai-bot.sqlite
LOG_LEVEL=info
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

The default schedule checks BTC every 30 minutes. If the extracted AI Research
text has not changed since the previous successful scrape, OpenAI and Telegram
are skipped to avoid duplicate messages and unnecessary API cost.

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
