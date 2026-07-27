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

const authScheme = (process.env.OPENAI_AUTH_SCHEME || "bearer").toLowerCase();
const baseURL = (process.env.OPENAI_BASE_URL || "").replace(/\/$/, "");
const jsonMode = parseBoolean(
  process.env.OPENAI_JSON_MODE,
  authScheme === "bearer" && !baseURL,
);

const imageAuthScheme = (process.env.IMAGE_AUTH_SCHEME || authScheme || "apikey").toLowerCase();
const imageBaseURL = (process.env.IMAGE_BASE_URL || "").replace(/\/$/, "");
const cardMode = (process.env.CARD_MODE || "html").toLowerCase();

module.exports = {
  coinex: {
    baseUrl: "https://www.coinex.com/futures",
    symbols,
    scrapeTimeoutMs: parsePositiveInteger(process.env.SCRAPE_TIMEOUT_MS, 45000),
    // Prefer EN futures page: https://www.coinex.com/en/futures/btc-usdt
    preferredLocalePath: process.env.COINEX_FUTURES_PATH || "/en/futures",
  },
  scheduler: {
    // Intraday monitoring is off by default — daily setup chart at 03:30 is enough.
    intradayEnabled: parseBoolean(process.env.INTRADAY_ENABLED, false),
    intervalMinutes: parsePositiveInteger(process.env.CHECK_INTERVAL_MINUTES, 60),
    // Daily setup cron in Asia/Tehran (default 03:30, after daily candle close).
    dailyCron: process.env.DAILY_SETUP_CRON || "30 3 * * *",
    timezone: "Asia/Tehran",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    baseURL: baseURL || undefined,
    authScheme,
    jsonMode,
  },
  image: {
    apiKey: process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: imageBaseURL || undefined,
    model: process.env.IMAGE_MODEL || "",
    authScheme: imageAuthScheme,
    size: process.env.IMAGE_SIZE || "1792x1024",
    quality: process.env.IMAGE_QUALITY || "hd",
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  runtime: {
    headless: parseBoolean(process.env.HEADLESS, true),
    databasePath: process.env.DATABASE_PATH || "./data/coinex-ai-bot.sqlite",
    logLevel: process.env.LOG_LEVEL || "info",
    cardScale: parsePositiveInteger(process.env.CARD_SCALE, 2),
    // Default and invalid values always use server-side HTML rendering.
    cardMode: ["api", "html", "auto"].includes(cardMode) ? cardMode : "html",
  },
};
