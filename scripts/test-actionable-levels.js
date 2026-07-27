const assert = require("node:assert/strict");
const {
  buildActionableLevels,
  isValidGeometry,
  computeRrNumber,
  ensureTradingPlanLevels,
} = require("../services/ensurePlanLevels");

function entryMid(entry) {
  const [a, b] = String(entry).split("-").map(Number);
  return b ? (a + b) / 2 : a;
}

const bad = ensureTradingPlanLevels(
  {
    bias: "Bearish",
    direction: "RANGE",
    current_price: "64500",
    entry: "63666-64770.3",
    stop_loss: "63475",
    tp1: "64198.3",
    tp2: "64636",
    tp3: "64948.8",
    risk_reward: "1:0.03",
    technical_analysis: {
      major_support: "63666,63000",
      major_resistance: "64948.8,65219.5",
    },
  },
  {
    bias: "Bearish",
    confidence: 71,
    chart_setup: { trade_allowed: false, direction: "RANGE" },
    chart_snapshot: {
      htf: {
        price: 64500,
        levels: {
          majorSupport: [63666, 63000],
          majorResistance: [64948.8, 65219.5],
        },
      },
    },
  },
  { futures: { price: 64500 } },
);

assert.equal(bad.direction, "RANGE");
assert.equal(bad.bias, "Bearish");
assert.ok(
  isValidGeometry({
    direction: bad.direction,
    bias: bad.bias,
    entry: bad.entry,
    stopLoss: bad.stop_loss,
    tp1: bad.tp1,
    tp2: bad.tp2,
    tp3: bad.tp3,
    price: 64500,
  }),
  `invalid geometry after rebuild: ${JSON.stringify({
    entry: bad.entry,
    sl: bad.stop_loss,
    tp1: bad.tp1,
    tp2: bad.tp2,
    tp3: bad.tp3,
    rr: bad.risk_reward,
  })}`,
);
assert.ok(computeRrNumber(bad.entry, bad.stop_loss, bad.tp1) >= 1);
assert.ok(Number(bad.tp1) < entryMid(bad.entry));
assert.ok(Number(bad.stop_loss) > entryMid(bad.entry));

const shortLevels = buildActionableLevels({
  bias: "Bearish",
  direction: "RANGE",
  price: 64500,
  supports: [63666, 63000],
  resistances: [64948.8, 65780],
});
assert.equal(shortLevels.side, "SHORT");
assert.ok(Number(shortLevels.tp1) < entryMid(shortLevels.entry));
assert.ok(Number(shortLevels.stop_loss) > entryMid(shortLevels.entry));
assert.ok(computeRrNumber(shortLevels.entry, shortLevels.stop_loss, shortLevels.tp1) >= 1.15);

const longLevels = buildActionableLevels({
  bias: "Bullish",
  direction: "RANGE",
  price: 64500,
  supports: [63666, 63000],
  resistances: [64948.8, 65780],
});
assert.equal(longLevels.side, "LONG");
assert.ok(Number(longLevels.tp1) > entryMid(longLevels.entry));
assert.ok(Number(longLevels.stop_loss) < entryMid(longLevels.entry));
assert.ok(computeRrNumber(longLevels.entry, longLevels.stop_loss, longLevels.tp1) >= 1.15);

console.log("actionable levels tests passed");
