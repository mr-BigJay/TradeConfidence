const assert = require("node:assert/strict");
const {
  collectSetupLevels,
  buildSetupChartHtml,
  formatSetupChartCaption,
} = require("../services/setupChartImage");

const plan = {
  symbol: "BTCUSDT",
  bias: "Bullish",
  direction: "LONG",
  confidence: 82,
  current_price: "65120",
  entry: "62000-62200",
  stop_loss: "60900",
  tp1: "63000",
  tp2: "64200",
  tp3: "65500",
  risk_reward: "1:2.5",
};

const levels = collectSetupLevels(plan);
assert.ok(levels.some((item) => item.key === "ENTRY" && item.kind === "zone"));
assert.ok(levels.some((item) => item.key === "SL"));
assert.ok(levels.some((item) => item.key === "TP1"));
assert.ok(levels.some((item) => item.key === "TP3"));

const candles = [];
let price = 64000;
for (let i = 0; i < 40; i += 1) {
  const open = price;
  const close = price + ((i % 2 === 0 ? 80 : -40) + i);
  candles.push({
    time: i,
    open,
    high: Math.max(open, close) + 40,
    low: Math.min(open, close) - 40,
    close,
    volume: 1000,
  });
  price = close;
}

const html = buildSetupChartHtml(plan, candles, { iranDate: "2026-07-27" });
assert.match(html, /BTC Daily Setup Chart/);
assert.match(html, /ENTRY/);
assert.match(html, /TP1/);
assert.match(html, /SL/);

const caption = formatSetupChartCaption(plan, { iranDate: "2026-07-27" });
assert.match(caption, /Entry: 62000-62200/);
assert.match(caption, /SL: 60900/);

console.log("setup chart tests passed");
