/**
 * Daily candle outlook after the 1D close (~03:30 Asia/Tehran).
 * Primary job: estimate whether the upcoming daily candle is likely green or red.
 */

function candleColor(candle) {
  if (!candle || !Number.isFinite(candle.open) || !Number.isFinite(candle.close)) return null;
  if (candle.close > candle.open) return "green";
  if (candle.close < candle.open) return "red";
  return "neutral";
}

function colorFa(color) {
  if (color === "green") return "سبز";
  if (color === "red") return "قرمز";
  return "خنثی";
}

/**
 * At/after daily close, Binance usually already opened a brand-new 1D bar.
 * Prefer the previous completed bar when the last bar is younger than ~6h.
 */
function pickClosedDailyCandle(dailyCandles = [], nowMs = Date.now()) {
  if (!Array.isArray(dailyCandles) || !dailyCandles.length) return null;
  const last = dailyCandles[dailyCandles.length - 1];
  const prev = dailyCandles[dailyCandles.length - 2] || null;
  const ageMs = Number.isFinite(last?.time) ? nowMs - Number(last.time) : Infinity;
  if (prev && ageMs < 6 * 60 * 60 * 1000) return prev;
  return last;
}

function leanFromText(value) {
  const text = String(value || "");
  if (/bull|green|صعود|سبز|long/i.test(text)) return "green";
  if (/bear|red|نزول|قرمز|short/i.test(text)) return "red";
  return null;
}

/**
 * Score whether the NEXT daily candle is more likely green or red.
 * Micro CVD is intentionally weak; HTF structure/trend/OI dominate.
 */
function buildDayOutlook({
  dailyCandles = [],
  chart = {},
  futures = {},
  options = {},
  validation = {},
  nowMs = Date.now(),
} = {}) {
  const closed = pickClosedDailyCandle(dailyCandles, nowMs);
  const closedColor = candleColor(closed);
  const htf = chart.htf || {};
  const votes = { green: 0, red: 0, reasons: [] };

  function add(side, weight, reason) {
    if (!side || side === "neutral") return;
    votes[side] += weight;
    votes.reasons.push(`${reason} (+${weight} ${side === "green" ? "سبز" : "قرمز"})`);
  }

  if (closedColor === "green") add("green", 1.2, "کندل دیروز سبز بسته شد");
  if (closedColor === "red") add("red", 1.2, "کندل دیروز قرمز بسته شد");

  if (/Bullish/i.test(htf.structure?.structure || "")) add("green", 1.5, "ساختار HTF صعودی");
  if (/Bearish/i.test(htf.structure?.structure || "")) add("red", 1.5, "ساختار HTF نزولی");

  if (htf.indicators?.trend === "Bullish") add("green", 1.4, "روند اندیکاتور روزانه/۴ساعته صعودی");
  if (htf.indicators?.trend === "Bearish") add("red", 1.4, "روند اندیکاتور روزانه/۴ساعته نزولی");

  if (htf.indicators?.emaStack === "bullish_stack") add("green", 1.0, "چینش EMA صعودی");
  if (htf.indicators?.emaStack === "bearish_stack") add("red", 1.0, "چینش EMA نزولی");

  if (futures.openInterest?.trend === "up" && closedColor === "green") {
    add("green", 1.0, "OI صعودی همراه کندل سبز");
  } else if (futures.openInterest?.trend === "up" && closedColor === "red") {
    add("red", 0.8, "OI صعودی روی فشار فروش");
  } else if (futures.openInterest?.trend === "down" && closedColor === "green") {
    add("red", 0.6, "OI نزولی؛ ضعف احتمالی خرید");
  }

  const funding = futures.fundingRatePercent;
  if (Number.isFinite(funding)) {
    if (funding <= -0.03) add("green", 0.7, "Funding منفی (سوخت شورت‌کاور)");
    if (funding >= 0.05) add("red", 0.7, "Funding مثبت شلوغ");
  }

  // Micro CVD: soft only.
  if (futures.cvd?.bias === "buy_pressure") add("green", 0.35, "CVD کوتاه‌مدت خریدار");
  if (futures.cvd?.bias === "sell_pressure") add("red", 0.35, "CVD کوتاه‌مدت فروشنده");

  if ((options.putCallRatio ?? 1) > 1.15) add("green", 0.5, "PCR بالا (پوشش/پوت)");
  if ((options.putCallRatio ?? 1) < 0.8) add("red", 0.4, "PCR پایین");

  if (validation.marketLean === "bullish" || validation.coinexClaimedBias === "bullish") {
    add("green", 0.6, "روایت/بازار متمایل به صعود");
  }
  if (validation.marketLean === "bearish" || validation.coinexClaimedBias === "bearish") {
    add("red", 0.6, "روایت/بازار متمایل به نزول");
  }

  const patternLean = leanFromText(chart.top_pattern?.name);
  const patternConf = Number(chart.top_pattern?.confidence || 0);
  if (patternLean && patternConf >= 70) {
    add(patternLean, 0.4, `الگوی کمکی ${chart.top_pattern.name}`);
  }

  const edge = votes.green - votes.red;
  let expected = "neutral";
  if (edge >= 1.2) expected = "green";
  else if (edge <= -1.2) expected = "red";

  const magnitude = Math.abs(edge);
  const confidence = Math.max(
    35,
    Math.min(90, Math.round(50 + magnitude * 10 + (closedColor && closedColor === expected ? 5 : 0))),
  );

  return {
    closed_candle: closed
      ? {
          open: closed.open,
          high: closed.high,
          low: closed.low,
          close: closed.close,
          color: closedColor,
          color_fa: colorFa(closedColor),
          time: closed.time || null,
        }
      : null,
    expected_day_candle: expected,
    expected_day_candle_fa: colorFa(expected),
    confidence,
    edge: Number(edge.toFixed(2)),
    green_score: Number(votes.green.toFixed(2)),
    red_score: Number(votes.red.toFixed(2)),
    reasons: votes.reasons.slice(0, 8),
    summary_fa:
      expected === "neutral"
        ? `سناریوی روز خنثی/رنج است (اطمینان ${confidence}%). احتمال غالب برای کندل سبز یا قرمز قطعی نیست.`
        : `سناریوی روز پیش‌رو: کندل احتمالاً ${colorFa(expected)} خواهد بود (اطمینان ${confidence}%).`,
  };
}

function evaluateOutlookHit(previousOutlook, actualClosedCandle) {
  const predicted = previousOutlook?.expected_day_candle || previousOutlook?.day_outlook || null;
  const actual = candleColor(actualClosedCandle);
  if (!predicted || predicted === "neutral" || !actual || actual === "neutral") {
    return {
      predicted,
      actual,
      hit: null,
      status: "unscored",
      note_fa: "پیش‌بینی قبلی خنثی بود یا کندل واقعی قابل امتیازدهی نیست.",
    };
  }
  const hit = predicted === actual;
  return {
    predicted,
    actual,
    hit,
    status: hit ? "hit" : "miss",
    note_fa: hit
      ? `پیش‌بینی دیروز (${colorFa(predicted)}) درست بود؛ کندل واقعاً ${colorFa(actual)} بسته شد.`
      : `پیش‌بینی دیروز (${colorFa(predicted)}) خطا بود؛ کندل واقعاً ${colorFa(actual)} بسته شد.`,
  };
}

module.exports = {
  candleColor,
  colorFa,
  pickClosedDailyCandle,
  buildDayOutlook,
  evaluateOutlookHit,
};
