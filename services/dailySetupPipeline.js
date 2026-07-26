const config = require("../config/config");
const {
  getDailySetupByIranDate,
  saveDailySetup,
  saveEvent,
} = require("../database/db");
const logger = require("../logger");
const { fetchBitunixMarketData } = require("./bitunixData");
const { createDailySetup } = require("./openaiSetup");
const { sendDailySetup } = require("./telegram");
const { getIranDateString, nextIranDailyCutoffIso } = require("./timeIran");

async function runDailySetup(options = {}) {
  const results = [];
  logger.info("Start daily setup pipeline");
  await saveEvent({ event: "daily_setup_start", message: "Start daily setup pipeline" });

  for (const symbol of config.coinex.symbols) {
    const result = { symbol, ok: false, mode: "daily_setup" };
    try {
      const iranDate = getIranDateString();
      const existing = await getDailySetupByIranDate(symbol, iranDate);

      if (existing && !options.force) {
        logger.info("Daily setup already exists for Iran date; skipping", { symbol, iranDate });
        await saveEvent({
          symbol,
          event: "daily_setup_skip",
          message: `Setup already exists for ${iranDate}`,
        });
        result.ok = true;
        result.skipped = true;
        result.reason = "already_exists";
        results.push(result);
        continue;
      }

      const bitunixDaily = await fetchBitunixMarketData(symbol, { interval: "1d" });
      const setup = await createDailySetup({ symbol, bitunixDaily });

      const createdAt = new Date().toISOString();
      const saved = await saveDailySetup({
        symbol,
        iran_date: iranDate,
        created_at: createdAt,
        valid_until: nextIranDailyCutoffIso(new Date()),
        direction: setup.direction,
        bias: setup.bias,
        confidence: setup.confidence,
        market_score: setup.market_score,
        risk_level: setup.risk_level,
        risk_notes: setup.risk_notes,
        entry: setup.entry,
        stop_loss: setup.stop_loss,
        tp1: setup.tp1,
        tp2: setup.tp2,
        tp3: setup.tp3,
        supports: setup.supports,
        resistances: setup.resistances,
        setup,
        bitunix_snapshot: bitunixDaily,
        status: "Active",
      });

      await sendDailySetup(setup, { iranDate });
      await saveEvent({
        symbol,
        event: "daily_setup_success",
        message: `Daily setup created for ${iranDate} conf=${setup.confidence}`,
      });

      result.ok = true;
      result.setup = saved;
      results.push(result);
    } catch (error) {
      logger.error("Daily setup failed", { symbol, error: error.message, stack: error.stack });
      await saveEvent({ symbol, event: "daily_setup_error", message: error.message });
      result.error = error.message;
      results.push(result);
    }
  }

  logger.info("Finish daily setup pipeline", { results });
  await saveEvent({
    event: "daily_setup_finish",
    message: JSON.stringify(results.map(({ symbol, ok, skipped, error }) => ({ symbol, ok, skipped, error }))),
  });
  return results;
}

module.exports = {
  runDailySetup,
};
