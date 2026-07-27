const assert = require("node:assert/strict");
const { ensureTradingPlanLevels } = require("../services/ensurePlanLevels");
const { applyRtlForPersian } = require("../services/telegram");
const { normalizeTradingPlan } = require("../services/tradingPlanNormalizer");

const blank = ensureTradingPlanLevels(
  {
    bias: "Neutral",
    direction: "RANGE",
    current_price: "65308.1",
    entry: "نامشخص",
    stop_loss: "نامشخص",
    tp1: "",
    tp2: "",
    tp3: "",
    supports: [],
    resistances: [],
    technical_analysis: {
      major_support: "65212.5,64948.8",
      major_resistance: "65780,66924.1",
    },
  },
  {
    chart_setup: { trade_allowed: false, direction: "RANGE" },
    chart_snapshot: {
      htf: {
        price: 65308.1,
        levels: {
          majorSupport: [65212.5, 64948.8],
          majorResistance: [65780, 66924.1],
        },
      },
    },
  },
  { futures: { price: 65308.1 } },
);

assert.notEqual(blank.entry, "نامشخص");
assert.notEqual(blank.stop_loss, "نامشخص");
assert.ok(blank.tp1);
assert.ok(blank.tp2);
assert.ok(blank.tp3);
assert.match(String(blank.risk_reward), /^1:/);

const fromPriceOnly = ensureTradingPlanLevels(
  {
    entry: "نامشخص",
    stop_loss: "نامشخص",
    current_price: "65000",
    technical_analysis: {},
  },
  {},
  { futures: { price: 65000 } },
);
assert.notEqual(fromPriceOnly.entry, "نامشخص");
assert.ok(fromPriceOnly.tp1);

const normalized = normalizeTradingPlan(
  "BTCUSDT",
  {
    bias: "Neutral",
    direction: "RANGE",
    entry: "نامشخص",
    stop_loss: "نامشخص",
    current_price: "65308",
    technical_analysis: {
      major_support: "65212.5,64948.8",
      major_resistance: "65780,66924.1",
    },
  },
  {
    chart_setup: {
      entry: "64948.8-65212.5",
      stop_loss: 64754.5,
      tp1: 65496,
      tp2: 65780,
      tp3: 66924,
      risk_reward: "1:1.4",
      trade_allowed: false,
      levels_ready: true,
    },
  },
);
assert.equal(normalized.entry, "64948.8-65212.5");
assert.equal(String(normalized.tp2), "65780");

const rtl = applyRtlForPersian("Validation: تأیید شد\nFunding: مثبت\nBias: Neutral");
assert.match(rtl, /\u202B.*تأیید/);
assert.match(rtl, /\u202B.*مثبت/);
assert.equal(rtl.split("\n")[2], "Bias: Neutral");

console.log("ensure levels + rtl tests passed");
