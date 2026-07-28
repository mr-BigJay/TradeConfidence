const config = require("../config/config");
const {
  getActiveDailySetup,
  saveEvent,
  saveSetupEvaluation,
} = require("../database/db");
const logger = require("../logger");
const { collectMarketBundle } = require("./marketBundle");
const { scoreMarketBundle } = require("./engines/scoringEngine");
const { formatScenarioCheckMessage } = require("./scenarioProgress");
const { sendTelegramMessage, splitTelegramText } = require("./telegram");
const { formatIranClock, getIranDateString, isPastIranDailyBriefTime } = require("./timeIran");

async function processScenarioCheck(symbol, options = {}) {
  const result = { symbol, ok: false, mode: "scenario_check" };
  const iranDate = getIranDateString();

  if (!options.force && !isPastIranDailyBriefTime()) {
    logger.info("Scenario check skipped; before 03:30 Iran brief", { symbol, iranDate });
    result.ok = true;
    result.skipped = true;
    result.reason = "before_brief";
    return result;
  }

  const dailySetup = await getActiveDailySetup(symbol, iranDate);
  if (!dailySetup) {
    logger.warn("No morning plan for scenario check", { symbol, iranDate });
    await saveEvent({
      symbol,
      event: "scenario_check_skip",
      message: `No daily plan for ${iranDate}`,
    });
    result.ok = true;
    result.skipped = true;
    result.reason = "no_daily_setup";
    return result;
  }

  const marketBundle = await collectMarketBundle(symbol, {
    includeResearch: true,
    period: "1h",
  });
  const engineScore = scoreMarketBundle(marketBundle);
  const progress = evaluateScenarioProgress({
    morningPlan: dailySetup,
    marketBundle,
    engineScore,
  });

  const text = formatScenarioCheckMessage(progress, {
    iranDate,
    clock: formatIranClock(),
  });

  const chunks = splitTelegramText(text);
  const messageIds = [];
  for (const chunk of chunks) {
    const sent = await sendTelegramMessage(chunk);
    if (sent?.result?.message_id) messageIds.push(sent.result.message_id);
  }

  await saveSetupEvaluation({
    setup_id: dailySetup.id,
    symbol,
    created_at: new Date().toISOString(),
    setup_status: dailySetup.status || "Active",
    confidence: engineScore.confidence,
    market_score: engineScore.market_score,
    rationale: progress.verdict_fa,
    evaluation: {
      type: "scenario_check_8h",
      progress,
      engineScore: {
        bias: engineScore.bias,
        confidence: engineScore.confidence,
        day_outlook: engineScore.day_outlook,
      },
    },
    bitunix_1h: {
      price: marketBundle.futures?.price,
      funding: marketBundle.futures?.fundingRatePercent,
      oi: marketBundle.futures?.openInterest,
    },
    telegram_sent: true,
  });

  await saveEvent({
    symbol,
    event: "telegram_success",
    message: `Scenario check telegram message_ids=${messageIds.join(",") || "n/a"}`,
  });
  await saveEvent({
    symbol,
    event: "scenario_check_success",
    message: `status=${progress.status} predicted=${progress.predicted} path=${progress.current_path} price=${progress.price}`,
  });

  logger.info("Scenario check sent", {
    symbol,
    status: progress.status,
    predicted: progress.predicted,
    path: progress.current_path,
    price: progress.price,
    messageIds,
  });

  result.ok = true;
  result.progress = progress;
  result.messageIds = messageIds;
  return result;
}

async function runScenarioCheck(options = {}) {
  logger.info("Start 8h scenario check pipeline");
  await saveEvent({ event: "scenario_check_start", message: "Start 8h scenario check" });

  const results = [];
  for (const symbol of config.coinex.symbols) {
    try {
      results.push(await processScenarioCheck(symbol, options));
    } catch (error) {
      logger.error("Scenario check failed", {
        symbol,
        error: error.message,
        stack: error.stack,
      });
      await saveEvent({ symbol, event: "scenario_check_error", message: error.message });
      results.push({ symbol, ok: false, mode: "scenario_check", error: error.message });
    }
  }

  await saveEvent({
    event: "scenario_check_finish",
    message: JSON.stringify(
      results.map(({ symbol, ok, skipped, reason, error }) => ({
        symbol,
        ok,
        skipped,
        reason,
        error,
      })),
    ),
  });
  logger.info("Finish 8h scenario check pipeline", { results });
  return results;
}

module.exports = {
  runScenarioCheck,
  processScenarioCheck,
};
