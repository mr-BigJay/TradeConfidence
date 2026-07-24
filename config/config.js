require("dotenv").config();

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const symbols = (process.env.COINEX_SYMBOLS || "BTCUSDT")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);

module.exports = {
  coinex: {
    baseUrl: "https://www.coinex.com/futures",
    symbols,
    scrapeTimeoutMs: parsePositiveInteger(process.env.SCRAPE_TIMEOUT_MS, 30000),
  },
  scheduler: {
    intervalMinutes: parsePositiveInteger(process.env.CHECK_INTERVAL_MINUTES, 30),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o",
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  runtime: {
    headless: parseBoolean(process.env.HEADLESS, true),
    databasePath: process.env.DATABASE_PATH || "./data/coinex-ai-bot.sqlite",
    logLevel: process.env.LOG_LEVEL || "info",
  },
};
