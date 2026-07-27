const assert = require("node:assert/strict");
const { normalizeTradingPlan, normalizePlanEvaluation } = require("../services/tradingPlanNormalizer");
const { formatDailyTradingPlanMessage } = require("../services/telegram");
const { scoreMarketBundle } = require("../services/engines/scoringEngine");
const { validateCoinexAgainstMarket } = require("../services/engines/validationEngine");
const { computePutCallRatio, computeMaxPain } = require("../services/providers/deribitOptions");

const bundle = {
  coinex: {
    available: true,
    text: "احتمال ادامه روند صعودی وجود دارد و حمایت مهم حفظ شده است.",
  },
  futures: {
    available: true,
    fundingRatePercent: -0.01,
    openInterest: { trend: "up", changePercent: 2 },
    cvd: { bias: "buy_pressure" },
    longShortRatio: 1.1,
    takerBuySellRatio: 1.2,
    change24hPercent: 1.8,
    price: 65000,
  },
  options: {
    available: true,
    putCallRatio: 1.2,
    maxPain: 64000,
    dealerGammaBias: "positive_gamma_pinning",
  },
  execution: {
    available: true,
    compare: { fundingDivergencePercent: 0.02, notes: ["test"] },
  },
};

const validation = validateCoinexAgainstMarket(bundle);
assert.equal(validation.status, "Confirmed");

const score = scoreMarketBundle(bundle);
assert.equal(score.bias, "Bullish");
assert.ok(score.confidence >= 50);

const plan = normalizeTradingPlan(
  "BTCUSDT",
  {
    bias: "Bullish",
    direction: "LONG",
    confidence: 78,
    market_score: 78,
    market_regime: "Trend",
    risk_level: "Medium",
    current_price: "65150",
    coinex_summary: "سناریوی صعودی",
    coinex_validation_status: "Confirmed",
    futures_analysis: { funding_status: "خنثی متمایل منفی", cvd_status: "خرید" },
    options_analysis: { pcr: "1.2", max_pain: "64000" },
    entry: "62000-62200",
    tp1: "63000",
    tp2: "64200",
    tp3: "65500",
    stop_loss: "60900",
    risk_reward: "1:3",
    reason: "CVD and OI confirm narrative",
  },
  score,
);

assert.equal(plan.entry, "62000-62200");
assert.equal(plan.direction, "LONG");

const evaluation = normalizePlanEvaluation(plan, {
  setup_status: "Active",
  confidence: 80,
  entry: "1",
  stop_loss: "2",
  tp1: "3",
});
assert.equal(evaluation.entry, "62000-62200");
assert.equal(evaluation.tp1, "63000");

const msg = formatDailyTradingPlanMessage(plan, { iranDate: "2026-07-27", validation });
assert.match(msg, /BTC Daily Trading Plan/);
assert.match(msg, /Trading Setup/);

const pcr = computePutCallRatio([
  { type: "call", open_interest: 10, volume: 2, strike: 65000 },
  { type: "put", open_interest: 20, volume: 4, strike: 64000 },
]);
assert.equal(pcr.oiPutCallRatio, 2);

const maxPain = computeMaxPain(
  [
    { type: "call", open_interest: 5, strike: 66000 },
    { type: "put", open_interest: 5, strike: 64000 },
    { type: "call", open_interest: 1, strike: 65000 },
    { type: "put", open_interest: 1, strike: 65000 },
  ],
  65000,
);
assert.ok(maxPain.maxPain);

console.log("market engine + trading plan tests passed");
