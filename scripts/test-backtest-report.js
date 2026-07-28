const assert = require("node:assert/strict");
const {
  buildRowFromPlanAndActual,
  formatBacktestPage,
  formatIranSlash,
  predictedCandleFromPlan,
  predictedPriceFromPlan,
  findCandleForIranDate,
  PAGE_SIZE,
} = require("../services/backtestReport");

assert.equal(PAGE_SIZE, 20);
assert.equal(formatIranSlash("2026-07-27"), "2026/07/27");

const plan = {
  iran_date: "2026-07-27",
  tp1: 65439.5,
  entry: "64800-65000",
  setup: {
    day_outlook: "green",
    day_outlook_fa: "سبز",
    tp1: 65439.5,
  },
};

assert.equal(predictedCandleFromPlan(plan), "green");
assert.equal(predictedPriceFromPlan(plan), 65439.5);

const hit = buildRowFromPlanAndActual(plan, {
  open: 65000,
  high: 65600,
  low: 64800,
  close: 65500,
});
assert.equal(hit.predicted_fa, "سبز");
assert.equal(hit.actual_fa, "سبز");
assert.equal(hit.touched_price, 65600);
assert.equal(hit.candle_hit, true);
assert.equal(hit.price_hit, true);
assert.match(hit.result_fa, /کندل محقق شد/);
assert.match(hit.result_fa, /قیمت محقق شد/);

const miss = buildRowFromPlanAndActual(plan, {
  open: 65000,
  high: 65200,
  low: 64000,
  close: 64100,
});
assert.equal(miss.actual_fa, "قرمز");
assert.equal(miss.candle_hit, false);
assert.equal(miss.price_hit, false);

const page = formatBacktestPage([hit, miss], { page: 0, total: 2, pageSize: 20 });
assert.match(page.text, /بک‌تست/);
assert.match(page.text, /2026\/07\/27/);
assert.match(page.text, /کندل پیش‌بینی‌شده: سبز/);

const openMs = Date.UTC(2026, 6, 27);
const found = findCandleForIranDate(
  [{ time: openMs, open: 1, high: 2, low: 0.5, close: 1.5 }],
  "2026-07-27",
);
assert.equal(found.close, 1.5);

console.log("backtest report tests passed");
