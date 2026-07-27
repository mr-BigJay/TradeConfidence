const assert = require("node:assert/strict");
const {
  buildDecisionWhy,
  formatDecisionWhyBlock,
  formatMorningCaption,
} = require("../services/decisionWhy");
const { formatSetupChartCaption } = require("../services/setupChartImage");

const plan = {
  bias: "Bullish",
  direction: "RANGE",
  confidence: 83,
  trade_allowed: false,
  day_outlook: "green",
  day_outlook_fa: "سبز",
  day_outlook_confidence: 68,
  closed_daily_candle: { open: 64338, close: 65375.1, color_fa: "سبز" },
  entry: "64806.7-65033.5",
  stop_loss: "64504.6",
  tp1: "65439.5",
  tp2: "65963",
  tp3: "66490.7",
  coinex_validation_status: "Partially Confirmed",
};

const lines = buildDecisionWhy(plan, {
  chart_setup: {
    trade_allowed: false,
    market_confirmation: true,
    technical_confirmation: true,
  },
});
assert.equal(lines.length, 2);
assert.match(lines[0], /طبق برآورد|سبز/);
assert.match(lines[1], /ناحیه|رصد/);
assert.doesNotMatch(lines.join("\n"), /Monitoring Only/);
assert.doesNotMatch(lines.join("\n"), /Futures /);

const block = formatDecisionWhyBlock(plan, {});
assert.match(block, /طبق برآورد/);

const caption = formatSetupChartCaption(plan, {
  iranDate: "2026-07-27",
  engineScore: { chart_setup: { trade_allowed: false } },
  replacing: true,
});
assert.match(caption, /طبق برآورد/);
assert.match(caption, /سبز/);
assert.match(caption, /ناحیه/);
assert.doesNotMatch(caption, /دلیل تصمیم/);
assert.doesNotMatch(caption, /حد سود: TP1/);
assert.ok(caption.split("\n").length <= 6);

const morning = formatMorningCaption(plan, { iranDate: "2026-07-27" });
assert.match(morning, /احتمالاً سبز/);

console.log("decision why tests passed");
