const assert = require("node:assert/strict");
const {
  analyzeChartIntelligence,
  detectStructure,
  detectPatterns,
  computeFibonacci,
} = require("../services/chart/analyzeChart");
const { scoreMarketBundle } = require("../services/engines/scoringEngine");
const { normalizeTradingPlan } = require("../services/tradingPlanNormalizer");

function makeCandles({ start = 100, count = 120, drift = 0.2, wave = 3 }) {
  const candles = [];
  let price = start;
  for (let i = 0; i < count; i += 1) {
    // Explicit local extrema so swing/structure detectors can fire.
    const phase = (i % 10) - 5;
    const swing = Math.sin(i / 5) * wave + phase * (wave * 0.08);
    const open = price;
    const close = price + drift + swing * 0.08;
    const wick = Math.abs(wave) * (0.15 + (i % 3) * 0.05);
    const high = Math.max(open, close) + wick + (phase === 4 ? Math.abs(wave) * 0.35 : 0);
    const low = Math.min(open, close) - wick - (phase === -4 ? Math.abs(wave) * 0.35 : 0);
    candles.push({
      time: i,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 7) * 50 + (i % 11 === 0 ? 800 : 0),
    });
    price = close;
  }
  return candles;
}

const up = makeCandles({ start: 60000, count: 150, drift: 40, wave: 120 });
const structure = detectStructure(up);
assert.match(structure.structure, /Bullish|Range|Transition/);

const patterns = detectPatterns(up, "1h");
assert.ok(Array.isArray(patterns));

const fib = computeFibonacci(up);
assert.equal(fib.available, true);
assert.ok(fib.levels["0.618"]);

const chart = analyzeChartIntelligence(
  {
    "1d": makeCandles({ start: 55000, count: 100, drift: 80, wave: 200 }),
    "4h": up,
    "1h": up,
    "15m": makeCandles({ start: 64000, count: 120, drift: 5, wave: 40 }),
    "5m": makeCandles({ start: 64500, count: 120, drift: 2, wave: 20 }),
  },
  {
    fundingRatePercent: 0.01,
    openInterest: { trend: "up" },
    cvd: { bias: "buy_pressure" },
    orderBook: { bias: "bid_heavy" },
  },
);

assert.equal(chart.available, true);
assert.ok(chart.checklistText.includes("Chart Intelligence"));
assert.ok(chart.setup);
assert.ok(chart.setup.rule.includes("Pattern alone"));

const bundle = {
  coinex: { available: true, text: "احتمال ادامه روند صعودی" },
  futures: {
    available: true,
    fundingRatePercent: 0.01,
    openInterest: { trend: "up" },
    cvd: { bias: "buy_pressure" },
    longShortRatio: 1.2,
    takerBuySellRatio: 1.2,
    change24hPercent: 1.2,
    price: 65000,
  },
  options: {
    available: true,
    putCallRatio: 1.2,
    maxPain: 64000,
    dealerGammaBias: "positive_gamma_pinning",
  },
  execution: { available: true, compare: { fundingDivergencePercent: 0 } },
  chart,
};

const score = scoreMarketBundle(bundle);
assert.ok(score.components);
assert.ok(typeof score.components.technical === "number");
assert.ok(score.chart_setup);

const plan = normalizeTradingPlan(
  "BTCUSDT",
  {
    bias: "Bullish",
    direction: "LONG",
    confidence: 80,
    technical_analysis: {
      mtf_summary: "1D bullish / 4H pullback",
      market_structure: "Bullish Structure",
      pattern: "Bull Flag 4H",
    },
    entry: "1-2",
    stop_loss: "0",
    tp1: "3",
  },
  score,
);

if (score.chart_setup.entry) {
  assert.equal(plan.entry, score.chart_setup.entry);
  assert.ok(plan.stop_loss);
  assert.ok(plan.tp1);
}

// Regression: Neutral/RANGE with empty GPT levels must still fill from S/R.
const rangePlan = normalizeTradingPlan(
  "BTCUSDT",
  {
    bias: "Neutral",
    direction: "RANGE",
    confidence: 75,
    current_price: "65308.1",
    entry: "نامشخص",
    stop_loss: "نامشخص",
    tp1: "",
    tp2: "",
    tp3: "",
    supports: ["65212.5", "64948.8"],
    resistances: ["65780", "66924.1"],
    technical_analysis: {
      major_support: "65212.5,64948.8",
      major_resistance: "65780,66924.1",
    },
  },
  {
    bias: "Neutral",
    confidence: 75,
    chart_setup: {
      trade_allowed: false,
      levels_ready: true,
      direction: "RANGE",
      entry: "64948.8-65212.5",
      stop_loss: 64754.5,
      tp1: 65496.2,
      tp2: 65780,
      tp3: 66924.1,
      risk_reward: "1:1.5",
    },
  },
);
assert.equal(rangePlan.entry, "64948.8-65212.5");
assert.notEqual(rangePlan.stop_loss, "نامشخص");
assert.ok(rangePlan.tp1);
assert.ok(rangePlan.tp2);
assert.match(rangePlan.technical_analysis.chart_setup_status, /RANGE levels mapped|confirmed/);

console.log("chart intelligence tests passed");
