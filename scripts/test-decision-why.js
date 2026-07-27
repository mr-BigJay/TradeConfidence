const assert = require("node:assert/strict");
const { buildDecisionWhy, formatDecisionWhyBlock } = require("../services/decisionWhy");
const { formatSetupChartCaption } = require("../services/setupChartImage");

const plan = {
  bias: "Bearish",
  direction: "RANGE",
  confidence: 71,
  trade_allowed: false,
  entry: "64754-64948.8",
  stop_loss: "65120",
  tp1: "64300",
  tp2: "63666",
  tp3: "63000",
  coinex_validation_status: "Partially Confirmed",
};

const lines = buildDecisionWhy(plan, {
  chart_setup: {
    trade_allowed: false,
    market_confirmation: true,
    technical_confirmation: false,
  },
  components: { futures: -4, technical: 8 },
});
assert.equal(lines.length, 2);
assert.match(lines[0], /بایاس نزولی|رنج|فروش/);
assert.match(lines[1], /ورود|SL|تأیید/);

const block = formatDecisionWhyBlock(plan, {});
assert.match(block, /دلیل تصمیم/);

const caption = formatSetupChartCaption(plan, {
  iranDate: "2026-07-27",
  engineScore: { chart_setup: { trade_allowed: false } },
});
assert.match(caption, /دلیل تصمیم/);
assert.match(caption, /رنج|نزولی|حمایت|مقاومت/);

console.log("decision why tests passed");
