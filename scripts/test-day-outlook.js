const assert = require("node:assert/strict");
const {
  candleColor,
  pickClosedDailyCandle,
  buildDayOutlook,
  evaluateOutlookHit,
} = require("../services/dayOutlook");
const { scoreMarketBundle } = require("../services/engines/scoringEngine");
const { getIranDateDaysAgo } = require("../services/timeIran");

assert.equal(candleColor({ open: 100, close: 101 }), "green");
assert.equal(candleColor({ open: 100, close: 99 }), "red");
assert.equal(candleColor({ open: 100, close: 100 }), "neutral");

const now = Date.now();
const closed = pickClosedDailyCandle(
  [
    { open: 1, high: 2, low: 0.5, close: 1.5, time: now - 24 * 3600 * 1000 },
    { open: 1.5, high: 1.6, low: 1.4, close: 1.55, time: now - 30 * 60 * 1000 },
  ],
  now,
);
assert.equal(closed.close, 1.5);

const outlook = buildDayOutlook({
  dailyCandles: [
    { open: 60000, high: 62000, low: 59000, close: 61500, time: now - 24 * 3600 * 1000 },
    { open: 61500, high: 61600, low: 61400, close: 61520, time: now - 20 * 60 * 1000 },
  ],
  chart: {
    htf: {
      structure: { structure: "Bullish Structure" },
      indicators: { trend: "Bullish", emaStack: "bullish_stack" },
    },
    top_pattern: { name: "Bull Flag", confidence: 72 },
  },
  futures: {
    openInterest: { trend: "up" },
    fundingRatePercent: -0.04,
    cvd: { bias: "buy_pressure" },
  },
  options: { putCallRatio: 1.2 },
  validation: { marketLean: "bullish", coinexClaimedBias: "bullish" },
  nowMs: now,
});

assert.equal(outlook.closed_candle.color, "green");
assert.equal(outlook.expected_day_candle, "green");
assert.equal(outlook.expected_day_candle_fa, "سبز");
assert.ok(outlook.confidence >= 50);
assert.ok(outlook.summary_fa.includes("سبز"));

const hit = evaluateOutlookHit({ expected_day_candle: "green" }, { open: 1, close: 2 });
assert.equal(hit.status, "hit");
const miss = evaluateOutlookHit({ expected_day_candle: "green" }, { open: 2, close: 1 });
assert.equal(miss.status, "miss");

assert.match(getIranDateDaysAgo(1), /^\d{4}-\d{2}-\d{2}$/);

const score = scoreMarketBundle({
  coinex: { available: true, text: "احتمال ادامه روند صعودی" },
  futures: {
    available: true,
    fundingRatePercent: -0.03,
    openInterest: { trend: "up" },
    cvd: { bias: "buy_pressure" },
    change24hPercent: 1,
    price: 65000,
  },
  options: { available: true, putCallRatio: 1.2, maxPain: 64000 },
  execution: { available: true, compare: {} },
  chart: {
    available: true,
    day_outlook: outlook,
    htf: outlook && {
      structure: { structure: "Bullish Structure" },
      indicators: { trend: "Bullish", emaStack: "bullish_stack" },
    },
    ltf: { indicators: { macd: { bias: "bullish", cross: "none" } }, volume: { confirmation: "trend_confirmed" } },
    top_pattern: { name: "Bull Flag", confidence: 72 },
    setup: {
      direction: "RANGE",
      trade_allowed: false,
      monitoring_only: true,
      market_confirmation: { passed: true },
      technical_confirmation: { passed: true },
      risk_management: { passed: true, entry: "1", stop_loss: 2, tp1: 3, risk_reward: "1:2" },
      rule: "Pattern alone never creates a trade.",
    },
  },
});

assert.ok(score.day_outlook);
assert.equal(score.day_outlook.expected_day_candle, "green");
assert.ok(score.components.futures <= 20);

console.log("day outlook tests passed");
