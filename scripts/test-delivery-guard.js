const assert = require("node:assert/strict");
const {
  planHasTelegramDelivery,
  isMorningDeliveryWatchWindow,
  withRetries,
} = require("../services/deliveryGuard");
const { isPastIranDailyBriefTime, getIranParts } = require("../services/timeIran");

(async () => {
  assert.equal(planHasTelegramDelivery(null), false);
  assert.equal(planHasTelegramDelivery({ setup: {} }), false);
  assert.equal(planHasTelegramDelivery({ setup: { telegram_sent: true } }), true);
  assert.equal(
    planHasTelegramDelivery({ setup: { telegram_message_ids: [1, 2] } }),
    true,
  );

  let attempts = 0;
  const ok = await withRetries(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    },
    { retries: 3, baseDelayMs: 1 },
  );
  assert.equal(ok, "ok");
  assert.equal(attempts, 3);

  assert.equal(typeof isPastIranDailyBriefTime(), "boolean");
  assert.equal(typeof isMorningDeliveryWatchWindow(), "boolean");
  assert.ok(getIranParts().hour >= 0);

  const scenario = require("../services/scenarioCheckPipeline");
  assert.equal(typeof scenario.runScenarioCheck, "function");
  const progress = require("../services/scenarioProgress");
  assert.equal(typeof progress.evaluateScenarioProgress, "function");

  console.log("delivery guard tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
