const assert = require("node:assert/strict");
const {
  evaluateScenarioProgress,
  formatScenarioCheckMessage,
} = require("../services/scenarioProgress");

const onTrack = evaluateScenarioProgress({
  morningPlan: {
    bias: "Bullish",
    direction: "RANGE",
    entry: "64800-65000",
    tp1: 65400,
    stop_loss: 64500,
    setup: {
      day_outlook: "green",
      day_outlook_fa: "سبز",
      closed_daily_candle: { open: 64000, close: 65000, color_fa: "سبز" },
      entry: "64800-65000",
      tp1: 65400,
      stop_loss: 64500,
      bias: "Bullish",
    },
  },
  marketBundle: {
    futures: { price: 65200, fundingRatePercent: 0.01, openInterest: { trend: "up" } },
    chart: {
      daily_candles_tail: [{ open: 65000, high: 65300, low: 64900, close: 65200 }],
    },
  },
  engineScore: { bias: "Bullish" },
});

assert.equal(onTrack.predicted, "green");
assert.equal(onTrack.current_path, "green");
assert.equal(onTrack.status, "on_track");
assert.match(onTrack.verdict_fa, /هم‌راستا|سبز/);

const offTrack = evaluateScenarioProgress({
  morningPlan: {
    setup: {
      day_outlook: "green",
      day_outlook_fa: "سبز",
      entry: "64800-65000",
      tp1: 65400,
      stop_loss: 64500,
    },
  },
  marketBundle: {
    futures: { price: 64600, fundingRatePercent: 0.02, openInterest: { trend: "down" } },
    chart: {
      daily_candles_tail: [{ open: 65000, high: 65100, low: 64550, close: 64600 }],
    },
  },
});
assert.equal(offTrack.status, "off_track");
assert.equal(offTrack.current_path, "red");

const text = formatScenarioCheckMessage(onTrack, {
  iranDate: "2026-07-28",
  clock: "11:30",
});
assert.match(text, /گزارش ۸ساعته/);
assert.match(text, /سناریوی ۰۳:۳۰/);
assert.match(text, /در مسیر تحقق/);
assert.ok(text.split("\n").length <= 16);

console.log("scenario progress tests passed");
