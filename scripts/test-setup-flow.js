const assert = require("node:assert/strict");
const { normalizeDailySetup, normalizeSetupEvaluation } = require("../services/setupNormalizer");
const { formatDailySetupMessage, formatSetupUpdateMessage } = require("../services/telegram");
const { getIranDateString, formatIranClock } = require("../services/timeIran");

const setup = normalizeDailySetup("BTCUSDT", {
  bias: "صعودی",
  direction: "LONG",
  confidence: "78%",
  market_score: 73,
  risk_level: "Medium",
  main_scenario: "خریداران کنترل را دارند اگر 64800 حفظ شود.",
  entry: "۶۴٬۸۰۰-۶۵٬۰۰۰",
  stop_loss: "64300",
  tp1: "65500",
  tp2: "66200",
  tp3: "67000",
  supports: ["64300", "63700"],
  resistances: ["65100", "66400"],
  invalidation: "از دست رفتن 64300",
});

assert.equal(setup.direction, "LONG");
assert.equal(setup.entry, "64800-65000");
assert.equal(setup.confidence, 78);

const evaluation = normalizeSetupEvaluation(setup, {
  setup_status: "Weakening",
  confidence: 58,
  previous_confidence: 78,
  market_score: 61,
  changes: ["MACD ضعیف شده", "OI کاهش یافته"],
  result: "ستاپ صبح ضعیف شده",
  entry: "99999",
  stop_loss: "11111",
  tp1: "22222",
});

assert.equal(evaluation.setup_status, "Weakening");
assert.equal(evaluation.entry, "64800-65000");
assert.equal(evaluation.stop_loss, "64300");
assert.equal(evaluation.tp1, "65500");

const dailyMsg = formatDailySetupMessage(setup, { iranDate: getIranDateString() });
assert.match(dailyMsg, /BTC Daily Setup/);
assert.match(dailyMsg, /Entry:/);

const updateMsg = formatSetupUpdateMessage(evaluation, setup, { clock: formatIranClock() });
assert.match(updateMsg, /BTC Update/);
assert.match(updateMsg, /Weakening/);
assert.doesNotMatch(updateMsg, /99999/);

console.log("setup flow tests passed");
