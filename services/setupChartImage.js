/**
 * Daily Trading Setup chart: candles + Entry / TP1-3 / SL marked.
 * Rendered via Playwright HTML → PNG for Telegram sendPhoto.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const config = require("../config/config");
const logger = require("../logger");
const { fetchBinanceKlines } = require("./providers/binanceFutures");
const { fetchFuturesKlines } = require("./marketData");
const { extractPrices, formatPrice, parseLevel, toAsciiDigits } = require("./numberFormat");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseEntryZone(entry) {
  const prices = extractPrices(entry);
  if (!prices.length) return null;
  if (prices.length === 1) return { low: prices[0], high: prices[0] };
  return { low: Math.min(prices[0], prices[1]), high: Math.max(prices[0], prices[1]) };
}

function collectSetupLevels(plan = {}) {
  const entry = parseEntryZone(plan.entry);
  const levels = [];
  if (entry) {
    levels.push({
      key: "ENTRY",
      label: "ENTRY",
      low: entry.low,
      high: entry.high,
      color: "#38bdf8",
      kind: "zone",
    });
  }

  const singles = [
    { key: "TP1", value: plan.tp1, color: "#22c55e" },
    { key: "TP2", value: plan.tp2, color: "#4ade80" },
    { key: "TP3", value: plan.tp3, color: "#86efac" },
    { key: "SL", value: plan.stop_loss, color: "#ef4444" },
  ];

  for (const item of singles) {
    const price = parseLevel(item.value);
    if (price === null) continue;
    levels.push({
      key: item.key,
      label: item.key,
      low: price,
      high: price,
      color: item.color,
      kind: "line",
    });
  }

  return levels;
}

function buildSetupChartSvg(candles, plan) {
  const width = 1280;
  const height = 720;
  const padLeft = 16;
  const padRight = 118;
  const padTop = 28;
  const padBottom = 28;
  const plotLeft = padLeft;
  const plotRight = width - padRight;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = height - padTop - padBottom;

  const levels = collectSetupLevels(plan);
  const levelPrices = levels.flatMap((item) => [item.low, item.high]);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  let max = Math.max(...highs, ...levelPrices);
  let min = Math.min(...lows, ...levelPrices);
  const pad = Math.max((max - min) * 0.08, 1);
  max += pad;
  min -= pad;
  const span = Math.max(max - min, 1);

  const step = plotWidth / Math.max(candles.length, 1);
  const bodyWidth = Math.max(1.2, Math.min(step * 0.55, 5));
  const wickWidth = Math.max(0.9, Math.min(bodyWidth * 0.35, 1.6));
  const yFor = (price) => padTop + ((max - price) / span) * plotHeight;

  const grid = [0.2, 0.4, 0.6, 0.8]
    .map((ratio) => {
      const y = padTop + ratio * plotHeight;
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="rgba(148,163,184,0.14)" stroke-width="1" />`;
    })
    .join("");

  const bodies = candles
    .map((candle, index) => {
      const x = plotLeft + step * (index + 0.5);
      const yHigh = yFor(candle.high);
      const yLow = yFor(candle.low);
      const yOpen = yFor(candle.open);
      const yClose = yFor(candle.close);
      const bullish = candle.close >= candle.open;
      const color = bullish ? "#22c55e" : "#ef4444";
      const top = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1.8);
      return `
        <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="${wickWidth}" />
        <rect x="${x - bodyWidth / 2}" y="${top}" width="${bodyWidth}" height="${bodyHeight}" fill="${color}" rx="0.6" />
      `;
    })
    .join("");

  const levelShapes = levels
    .map((level) => {
      if (level.kind === "zone" && level.high !== level.low) {
        const y1 = yFor(level.high);
        const y2 = yFor(level.low);
        const top = Math.min(y1, y2);
        const h = Math.max(Math.abs(y2 - y1), 8);
        const mid = top + h / 2;
        return `
          <rect x="${plotLeft}" y="${top}" width="${plotWidth}" height="${h}" fill="${level.color}" opacity="0.16" />
          <line x1="${plotLeft}" y1="${top}" x2="${plotRight}" y2="${top}" stroke="${level.color}" stroke-width="1.5" stroke-dasharray="5 4" />
          <line x1="${plotLeft}" y1="${top + h}" x2="${plotRight}" y2="${top + h}" stroke="${level.color}" stroke-width="1.5" stroke-dasharray="5 4" />
          <rect x="${plotRight + 6}" y="${mid - 14}" rx="8" width="104" height="28" fill="${level.color}" />
          <text x="${plotRight + 58}" y="${mid + 5}" fill="#041018" font-size="13" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-weight="800">${level.label}</text>
        `;
      }

      const y = yFor(level.low);
      const dash = level.key === "SL" ? "7 5" : "4 3";
      const widthTag = level.key === "ENTRY" ? 104 : 90;
      return `
        <line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="${level.color}" stroke-width="2" stroke-dasharray="${dash}" />
        <rect x="${plotRight + 6}" y="${y - 14}" rx="8" width="${widthTag}" height="28" fill="${level.color}" />
        <text x="${plotRight + 6 + widthTag / 2}" y="${y + 5}" fill="#041018" font-size="13" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-weight="800">${level.label} ${escapeHtml(formatPrice(level.low))}</text>
      `;
    })
    .join("");

  const last = candles[candles.length - 1];
  const lastY = yFor(last.close);
  const priceLabel = formatPrice(plan.current_price || last.close);

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1220" />
          <stop offset="100%" stop-color="#111827" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" rx="18" />
      ${grid}
      ${bodies}
      ${levelShapes}
      <line x1="${plotLeft}" y1="${lastY}" x2="${plotRight}" y2="${lastY}" stroke="rgba(250,250,250,0.28)" stroke-dasharray="2 3" stroke-width="1" />
      <rect x="${plotRight + 6}" y="${Math.min(Math.max(lastY - 14, 8), height - 40)}" rx="8" width="104" height="28" fill="#e2e8f0" />
      <text x="${plotRight + 58}" y="${Math.min(Math.max(lastY + 5, 27), height - 21)}" fill="#0f172a" font-size="13" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-weight="800">${escapeHtml(priceLabel)}</text>
    </svg>
  `;
}

function buildSetupChartHtml(plan, candles, meta = {}) {
  const direction = toAsciiDigits(plan.direction || "RANGE");
  const bias = toAsciiDigits(plan.bias || "Neutral");
  const dateLabel = meta.iranDate || "";
  const legend = [
    `Entry: ${formatPrice(plan.entry) || "-"}`,
    `SL: ${formatPrice(plan.stop_loss) || "-"}`,
    `TP1: ${formatPrice(plan.tp1) || "-"}`,
    `TP2: ${formatPrice(plan.tp2) || "-"}`,
    `TP3: ${formatPrice(plan.tp3) || "-"}`,
  ].join("   ·   ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&family=IBM+Plex+Mono:wght@600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1280px;
      background: #020617;
      color: #e2e8f0;
      font-family: "IBM Plex Sans", sans-serif;
    }
    #setup-chart {
      width: 1280px;
      padding: 28px 28px 24px;
      background:
        radial-gradient(1000px 480px at 12% -10%, rgba(56,189,248,0.16), transparent 60%),
        radial-gradient(900px 420px at 95% 110%, rgba(34,197,94,0.10), transparent 55%),
        #020617;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 18px;
      gap: 16px;
    }
    .title {
      font-size: 34px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .meta {
      font-family: "IBM Plex Mono", monospace;
      font-size: 15px;
      color: #94a3b8;
      text-align: right;
      line-height: 1.55;
    }
    .pill {
      display: inline-block;
      margin-left: 8px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(148,163,184,0.12);
      color: #e2e8f0;
      font-size: 13px;
      font-weight: 700;
    }
    .pill.long { background: rgba(34,197,94,0.18); color: #86efac; }
    .pill.short { background: rgba(239,68,68,0.18); color: #fca5a5; }
    .chart-wrap {
      border: 1px solid rgba(148,163,184,0.18);
      border-radius: 20px;
      overflow: hidden;
      background: #0b1220;
    }
    .footer {
      margin-top: 16px;
      font-family: "IBM Plex Mono", monospace;
      font-size: 15px;
      color: #cbd5e1;
      letter-spacing: 0.01em;
    }
  </style>
</head>
<body>
  <div id="setup-chart">
    <div class="header">
      <div>
        <div class="title">BTC Daily Setup Chart</div>
      </div>
      <div class="meta">
        ${escapeHtml(dateLabel)} · after daily close<br/>
        Bias ${escapeHtml(bias)}
        <span class="pill ${direction === "LONG" ? "long" : direction === "SHORT" ? "short" : ""}">${escapeHtml(direction)}</span>
        <span class="pill">${escapeHtml(String(plan.confidence ?? 0))}%</span>
      </div>
    </div>
    <div class="chart-wrap">
      ${buildSetupChartSvg(candles, plan)}
    </div>
    <div class="footer">${escapeHtml(legend)}</div>
  </div>
</body>
</html>`;
}

async function launchBrowser() {
  process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = "0";
  return chromium.launch({
    headless: true,
    timeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-zygote",
      "--single-process",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=384",
      "--font-render-hinting=none",
    ],
  });
}

async function renderDailySetupChart(plan, meta = {}) {
  const symbol = plan.symbol || "BTCUSDT";
  let candles = [];
  let candleSource = null;

  try {
    // Prefer Binance 4H after daily candle close.
    candles = await fetchBinanceKlines(symbol, "4h", 90);
    candleSource = "binance_4h";
    logger.info("Fetched 4H candles for setup chart", { symbol, candles: candles.length });
  } catch (error) {
    logger.warn("Binance 4H candles failed for setup chart; trying 1H", { error: error.message });
    try {
      candles = await fetchBinanceKlines(symbol, "1h", 120);
      candleSource = "binance_1h";
    } catch (inner) {
      logger.warn("Binance candles unavailable; falling back to CoinEx 1H", {
        error: inner.message,
      });
      try {
        candles = await fetchFuturesKlines(symbol, { limit: 120 });
        candleSource = "coinex_1h";
      } catch (fallbackError) {
        logger.warn("Setup chart candle fetch failed", { error: fallbackError.message });
      }
    }
  }

  if (!candles.length) {
    throw new Error("No candles available for setup chart");
  }

  const html = buildSetupChartHtml(plan, candles, { ...meta, candleSource });
  await fs.mkdir("output", { recursive: true });
  const filePath = path.join(
    "output",
    `${symbol}-setup-chart-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );

  const scale = Math.min(Math.max(config.runtime.cardScale || 2, 1), 2);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 860 },
      deviceScaleFactor: scale,
    });
    await page.emulateMedia({ media: "screen" });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.waitForTimeout(800);
    await page.locator("#setup-chart").screenshot({
      path: filePath,
      type: "png",
      animations: "disabled",
    });
    logger.info("Daily setup chart created", { filePath, scale, candleSource });
    return filePath;
  } finally {
    if (browser) await browser.close();
  }
}

const { formatDecisionWhyBlock } = require("./decisionWhy");

function formatSetupChartCaption(plan, meta = {}) {
  const styleNote =
    plan.direction === "RANGE" && /bear/i.test(String(plan.bias || ""))
      ? "سبک سطوح: فروش واکنش به مقاومت (رصد رنج)"
      : plan.direction === "RANGE" && /bull/i.test(String(plan.bias || ""))
        ? "سبک سطوح: خرید واکنش به حمایت (رصد رنج)"
        : null;

  return [
    "چارت ستاپ روزانه BTC",
    meta.iranDate ? `تاریخ: ${meta.iranDate}` : null,
    `سناریوی کندل روز: ${plan.day_outlook_fa || meta.engineScore?.day_outlook?.expected_day_candle_fa || "خنثی"} (${plan.day_outlook_confidence ?? meta.engineScore?.day_outlook?.confidence ?? plan.confidence ?? 0}%)`,
    plan.closed_daily_candle?.color_fa || meta.engineScore?.day_outlook?.closed_candle?.color_fa
      ? `کندل بسته‌شده دیروز: ${plan.closed_daily_candle?.color_fa || meta.engineScore.day_outlook.closed_candle.color_fa}${
          (plan.closed_daily_candle || meta.engineScore?.day_outlook?.closed_candle)?.open != null
            ? ` (O ${(plan.closed_daily_candle || meta.engineScore.day_outlook.closed_candle).open} → C ${(plan.closed_daily_candle || meta.engineScore.day_outlook.closed_candle).close})`
            : ""
        }`
      : null,
    `بایاس: ${plan.bias || "Neutral"} | ${plan.direction || "RANGE"} | ${plan.confidence ?? 0}%`,
    styleNote,
    plan.trade_allowed === false ? "وضعیت: فقط رصد (Monitoring Only)" : null,
    `ورود: ${plan.entry || "-"}`,
    `حد سود: TP1 ${plan.tp1 || "-"} | TP2 ${plan.tp2 || "-"} | TP3 ${plan.tp3 || "-"}`,
    `حد ضرر: ${plan.stop_loss || "-"} | نسبت سود به زیان: ${plan.risk_reward || "-"}`,
    "",
    formatDecisionWhyBlock(plan, meta.engineScore || {}),
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

module.exports = {
  renderDailySetupChart,
  buildSetupChartHtml,
  collectSetupLevels,
  formatSetupChartCaption,
};
