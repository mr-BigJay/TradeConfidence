const config = require("../config/config");
const {
  getActiveDailySetup,
  getLatestContent,
  getLatestSetupEvaluation,
  saveContent,
  saveEvent,
  saveSetupEvaluation,
  updateDailySetupStatus,
} = require("../database/db");
const logger = require("../logger");
const { scrapeAiResearch } = require("../playwright/scraper");
const { buildContentFingerprint, isSameResearch } = require("./contentFingerprint");
const { collectMarketBundle } = require("./marketBundle");
const { scoreMarketBundle } = require("./engines/scoringEngine");
const { evaluateDailyTradingPlan } = require("./openaiTradingPlan");
const { sendSetupUpdate } = require("./telegram");
const { formatIranClock, getIranDateString } = require("./timeIran");

async function maybeAttachFreshResearch(symbol, marketBundle, options = {}) {
  // If bundle already has research, use fingerprinting against DB.
  if (marketBundle.coinex?.available && marketBundle.coinex.text) {
    const fingerprint = buildContentFingerprint(marketBundle.coinex.text);
    const latestContent = await getLatestContent(symbol);
    const unchanged = !options.force && isSameResearch(latestContent, fingerprint);
    return {
      text: unchanged ? marketBundle.coinex.text : marketBundle.coinex.text,
      fingerprint,
      unchanged,
      scrapeResult: {
        text: marketBundle.coinex.text,
        datetime: marketBundle.coinex.scrapedAt || new Date().toISOString(),
        url: marketBundle.coinex.url,
      },
      isNew: !unchanged,
    };
  }

  try {
    const scrapeResult = await scrapeAiResearch(symbol);
    const fingerprint = buildContentFingerprint(scrapeResult.text);
    const latestContent = await getLatestContent(symbol);
    const unchanged = !options.force && isSameResearch(latestContent, fingerprint);
    return {
      text: scrapeResult.text,
      fingerprint,
      unchanged,
      scrapeResult,
      isNew: !unchanged,
    };
  } catch (error) {
    logger.warn("Intraday research refresh failed", { symbol, error: error.message });
    return {
      text: "",
      fingerprint: null,
      unchanged: true,
      isNew: false,
      scrapeError: error.message,
    };
  }
}

async function processIntradaySymbol(symbol, options = {}) {
  const result = { symbol, ok: false, mode: "intraday" };
  const iranDate = getIranDateString();
  const dailySetup = await getActiveDailySetup(symbol, iranDate);

  if (!dailySetup) {
    logger.warn("No daily trading plan for today; intraday skipped", { symbol, iranDate });
    await saveEvent({
      symbol,
      event: "intraday_skip",
      message: `No daily plan for ${iranDate}`,
    });
    result.ok = true;
    result.skipped = true;
    result.reason = "no_daily_setup";
    return result;
  }

  if (dailySetup.status === "Invalidated" && !options.force) {
    logger.info("Daily plan already invalidated; skipping intraday", { symbol, iranDate });
    await saveEvent({
      symbol,
      event: "intraday_skip",
      message: "Plan already invalidated",
    });
    result.ok = true;
    result.skipped = true;
    result.reason = "invalidated";
    return result;
  }

  const marketBundle = await collectMarketBundle(symbol, {
    includeResearch: true,
    period: "1h",
  });
  const research = await maybeAttachFreshResearch(symbol, marketBundle, options);
  const engineScore = scoreMarketBundle(marketBundle);
  const evaluation = await evaluateDailyTradingPlan({
    symbol,
    dailyPlan: {
      ...dailySetup,
      ...(dailySetup.setup || {}),
      supports: dailySetup.supports,
      resistances: dailySetup.resistances,
    },
    marketBundle,
    engineScore,
    validation: engineScore.validation,
  });

  await updateDailySetupStatus(
    dailySetup.id,
    evaluation.setup_status,
    evaluation.confidence,
    evaluation.market_score,
  );

  if (research.fingerprint && research.scrapeResult && research.isNew) {
    await saveContent({
      symbol,
      textHash: research.fingerprint.contentHash,
      rawText: research.scrapeResult.text,
      scrapedAt: research.scrapeResult.datetime,
      sourceUpdatedAt: research.fingerprint.sourceUpdatedAt,
    });
  }

  await sendSetupUpdate(evaluation, dailySetup, {
    clock: formatIranClock(),
  });

  await saveSetupEvaluation({
    setup_id: dailySetup.id,
    symbol,
    created_at: new Date().toISOString(),
    research_text_hash: research.fingerprint?.contentHash || null,
    research_source_updated_at: research.fingerprint?.sourceUpdatedAt || null,
    setup_status: evaluation.setup_status,
    confidence: evaluation.confidence,
    market_score: evaluation.market_score,
    rationale: evaluation.rationale || evaluation.result,
    evaluation: {
      ...evaluation,
      engineScore,
      validation: engineScore.validation,
    },
    bitunix_1h: {
      binance: marketBundle.futures?.raw || null,
      deribit: marketBundle.options?.raw || null,
      bitunix: marketBundle.execution?.raw || null,
    },
    telegram_sent: true,
  });

  await saveEvent({
    symbol,
    event: "intraday_success",
    message: `status=${evaluation.setup_status} conf=${evaluation.confidence} research=${research.isNew ? "new" : "same_or_missing"}`,
  });

  result.ok = true;
  result.evaluation = evaluation;
  return result;
}

async function runIntradayMonitor(options = {}) {
  logger.info("Start intraday monitor pipeline");
  await saveEvent({ event: "intraday_start", message: "Start intraday monitor pipeline" });

  const results = [];
  for (const symbol of config.coinex.symbols) {
    try {
      results.push(await processIntradaySymbol(symbol, options));
    } catch (error) {
      logger.error("Intraday monitor failed", {
        symbol,
        error: error.message,
        stack: error.stack,
      });
      await saveEvent({ symbol, event: "intraday_error", message: error.message });
      results.push({ symbol, ok: false, mode: "intraday", error: error.message });
    }
  }

  logger.info("Finish intraday monitor pipeline", { results });
  await saveEvent({
    event: "intraday_finish",
    message: JSON.stringify(
      results.map(({ symbol, ok, skipped, error, reason }) => ({
        symbol,
        ok,
        skipped,
        error,
        reason,
      })),
    ),
  });
  return results;
}

module.exports = {
  runIntradayMonitor,
  processIntradaySymbol,
};
