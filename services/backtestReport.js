/**
 * Backtest report: morning day-outlook vs actual closed daily candle / price touch.
 */

const { listDailySetups, countDailySetups, getDailySetupByIranDate } = require("../database/db");
const { fetchBinanceKlines } = require("./providers/binanceFutures");
const { candleColor, colorFa, DAY_MS } = require("./dayOutlook");
const logger = require("../logger");

const PAGE_SIZE = 20;

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatIranSlash(iranDate) {
  if (!iranDate) return "-";
  return String(iranDate).replace(/-/g, "/");
}

function nextIranDate(iranDate) {
  const [y, m, d] = String(iranDate).split("-").map(Number);
  if (!y || !m || !d) return null;
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + 1);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function predictedPriceFromPlan(plan) {
  const setup = plan.setup || {};
  return (
    toNumber(setup.tp1) ||
    toNumber(plan.tp1) ||
    toNumber(String(setup.entry || plan.entry || "").split("-").pop())
  );
}

function predictedCandleFromPlan(plan) {
  const setup = plan.setup || {};
  return (
    setup.day_outlook ||
    setup.day_outlook_full?.expected_day_candle ||
    plan.day_outlook ||
    null
  );
}

/**
 * Map Iran calendar date YYYY-MM-DD to Binance 1D candle that opens 00:00 UTC that day.
 * Iran date at 03:30 = same calendar day as UTC date for the new daily bar.
 */
function findCandleForIranDate(candles, iranDate) {
  if (!iranDate || !candles?.length) return null;
  const [y, m, d] = String(iranDate).split("-").map(Number);
  const openMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  return (
    candles.find((c) => Number(c.time) === openMs) ||
    candles.find((c) => {
      const t = Number(c.time);
      return t >= openMs && t < openMs + DAY_MS;
    }) ||
    null
  );
}

async function loadDailyCandles(symbol) {
  try {
    return await fetchBinanceKlines(symbol, "1d", 120);
  } catch (error) {
    logger.warn("Backtest klines fetch failed", { symbol, error: error.message });
    return [];
  }
}

function buildRowFromPlanAndActual(plan, actualCandle, nextPlanClosed = null) {
  const predicted = predictedCandleFromPlan(plan) || "neutral";
  const predictedFa = colorFa(predicted);
  const predictedPrice = predictedPriceFromPlan(plan);

  const actual =
    actualCandle ||
    (nextPlanClosed
      ? {
          open: nextPlanClosed.open,
          high: nextPlanClosed.high,
          low: nextPlanClosed.low,
          close: nextPlanClosed.close,
        }
      : null);

  const actualColor = candleColor(actual);
  const actualFa = actualColor ? colorFa(actualColor) : "نامشخص";

  let touchedPrice = null;
  let priceHit = null;
  if (actual && predictedPrice != null) {
    if (predicted === "green") {
      touchedPrice = toNumber(actual.high);
      priceHit = touchedPrice != null && touchedPrice >= predictedPrice;
    } else if (predicted === "red") {
      touchedPrice = toNumber(actual.low);
      priceHit = touchedPrice != null && touchedPrice <= predictedPrice;
    } else {
      touchedPrice = toNumber(actual.close);
      priceHit = null;
    }
  }

  let candleHit = null;
  if (actualColor && predicted !== "neutral") {
    candleHit = actualColor === predicted;
  } else if (actualColor && predicted === "neutral") {
    candleHit = null;
  }

  let resultFa = "هنوز بسته نشده / داده ناکافی";
  if (actualColor) {
    const candlePart =
      candleHit === true
        ? "کندل محقق شد ✅"
        : candleHit === false
          ? "کندل محقق نشد ❌"
          : "کندل خنثی بود";
    const pricePart =
      priceHit === true
        ? "قیمت محقق شد ✅"
        : priceHit === false
          ? "قیمت محقق نشد ❌"
          : predictedPrice == null
            ? "هدف قیمت ثبت نشده"
            : "هدف قیمت قابل سنجش نیست";
    resultFa = `${candlePart} | ${pricePart}`;
  }

  return {
    iran_date: plan.iran_date,
    iran_date_fa: formatIranSlash(plan.iran_date),
    predicted,
    predicted_fa: predictedFa,
    predicted_price: predictedPrice,
    actual_color: actualColor,
    actual_fa: actualFa,
    touched_price: touchedPrice,
    candle_hit: candleHit,
    price_hit: priceHit,
    result_fa: resultFa,
    confidence: plan.confidence ?? plan.setup?.day_outlook_confidence ?? null,
  };
}

function formatBacktestPage(rows, { page = 0, total = 0, pageSize = PAGE_SIZE } = {}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageIndex = Math.min(Math.max(0, page), totalPages - 1);

  if (!rows.length) {
    return {
      text: [
        "📊 بک‌تست پیش‌بینی روزانه BTC",
        "",
        "هنوز پیش‌بینی ذخیره‌شده‌ای نیست.",
        "بعد از گزارش‌های ۰۳:۳۰، نتایج اینجا می‌آید.",
      ].join("\n"),
      page: 0,
      totalPages: 1,
      total: 0,
    };
  }

  const lines = [
    "📊 بک‌تست پیش‌بینی روزانه BTC",
    `صفحه ${pageIndex + 1} از ${totalPages} | مجموع ${total} روز`,
    "مرتب‌سازی: آخرین پیش‌بینی",
    "",
  ];

  for (const row of rows) {
    lines.push(`روز ${row.iran_date_fa}:`);
    lines.push(`کندل پیش‌بینی‌شده: ${row.predicted_fa}`);
    lines.push(
      `قیمت پیش‌بینی‌شده: ${row.predicted_price != null ? row.predicted_price : "نامشخص"}`,
    );
    lines.push(`کندل بسته‌شده: ${row.actual_fa}`);
    lines.push(
      `قیمت تاچ‌شده: ${row.touched_price != null ? row.touched_price : "نامشخص"}`,
    );
    lines.push(`نتیجه: ${row.result_fa}`);
    lines.push("────────────");
  }

  return {
    text: lines.join("\n"),
    page: pageIndex,
    totalPages,
    total,
  };
}

async function buildBacktestPage(symbol, page = 0, pageSize = PAGE_SIZE) {
  const total = await countDailySetups(symbol);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageIndex = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const offset = pageIndex * pageSize;
  const plans = await listDailySetups(symbol, { limit: pageSize, offset });
  const candles = await loadDailyCandles(symbol);

  const rows = [];
  for (const plan of plans) {
    let actual = findCandleForIranDate(candles, plan.iran_date);
    if (!actual) {
      const nextDate = nextIranDate(plan.iran_date);
      const nextPlan = nextDate ? await getDailySetupByIranDate(symbol, nextDate) : null;
      const closed = nextPlan?.setup?.closed_daily_candle || null;
      if (closed) {
        actual = {
          open: closed.open,
          high: closed.high,
          low: closed.low,
          close: closed.close,
        };
      }
    }
    // Today's still-open candle: mark incomplete if close_time in future
    if (actual && Number.isFinite(Number(actual.time))) {
      const stillOpen = Date.now() < Number(actual.time) + DAY_MS;
      if (stillOpen) {
        rows.push(
          buildRowFromPlanAndActual(plan, null, null),
        );
        continue;
      }
    }
    rows.push(buildRowFromPlanAndActual(plan, actual, null));
  }

  return formatBacktestPage(rows, { page: pageIndex, total, pageSize });
}

function backtestKeyboard(page, totalPages) {
  const buttons = [];
  const row = [];
  if (page > 0) {
    row.push({ text: "◀️ قبلی", callback_data: `bt:${page - 1}` });
  }
  row.push({ text: `${page + 1}/${totalPages}`, callback_data: `bt:noop:${page}` });
  if (page + 1 < totalPages) {
    row.push({ text: "بعدی ▶️", callback_data: `bt:${page + 1}` });
  }
  buttons.push(row);
  buttons.push([{ text: "🔄 بروزرسانی", callback_data: `bt:${page}` }]);
  buttons.push([{ text: "🏠 منو", callback_data: "menu:home" }]);
  return { inline_keyboard: buttons };
}

function mainMenuKeyboard() {
  return {
    keyboard: [[{ text: "📊 بک تست" }], [{ text: "ℹ️ راهنما" }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function formatMainMenu() {
  return [
    "ربات BTC Analyzer",
    "",
    "از منو انتخاب کن:",
    "📊 بک تست — نتیجه پیش‌بینی‌های روزانه (۲۰تایی، صفحه‌بندی)",
    "",
    "گزارش خودکار:",
    "• ۰۳:۳۰ سناریوی کندل روز",
    "• ۱۱:۳۰ و ۱۹:۳۰ پیگیری سناریو",
  ].join("\n");
}

module.exports = {
  PAGE_SIZE,
  buildBacktestPage,
  formatBacktestPage,
  buildRowFromPlanAndActual,
  backtestKeyboard,
  mainMenuKeyboard,
  formatMainMenu,
  predictedPriceFromPlan,
  predictedCandleFromPlan,
  findCandleForIranDate,
  formatIranSlash,
};
