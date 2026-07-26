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
const { fetchBitunixMarketData } = require("./bitunixData");
const { evaluateDailySetup } = require("./openaiSetup");
const { sendSetupUpdate } = require("./telegram");
const { formatIranClock, getIranDateString } = require("./timeIran");

async function maybeScrapeResearch(symbol, options = {}) {
  try {
    const scrapeResult = await scrapeAiResearch(symbol);
    const fingerprint = buildContentFingerprint(scrapeResult.text);
    const latestContent = await getLatestContent(symbol);
    const unchanged = isSameResearch(latestContent, fingerprint);

    if (!options.force && unchanged) {
      return {
        text: "",
        fingerprint,
        unchanged: true,
        scrapeResult,
      };
    }

    return {
      text: scrapeResult.text,
      fingerprint,
      unchanged: false,
      scrapeResult,
    };
  } catch (error) {
    logger.warn("CoinEx research scrape failed; continuing with Bitunix-only evaluation", {
      symbol,
      error: error.message,
    });
    await saveEvent({
      symbol,
      event: "research_scrape_error",
      message: error.message,
    });
    return {
      text: "",
      fingerprint: null,
      unchanged: true,
      scrapeError: error.message,
    };
  }
}

async function processIntradaySymbol(symbol, options = {}) {
  const result = { symbol, ok: false, mode: "intraday" };
  const iranDate = getIranDateString();
  const dailySetup = await getActiveDailySetup(symbol, iranDate);

  if (!dailySetup) {
    logger.warn("No daily setup for today; intraday skipped", { symbol, iranDate });
    await saveEvent({
      symbol,
      event: "intraday_skip",
      message: `No daily setup for ${iranDate}`,
    });
    result.ok = true;
    result.skipped = true;
    result.reason = "no_daily_setup";
    return result;
  }

  if (dailySetup.status === "Invalidated" && !options.force) {
    logger.info("Daily setup already invalidated; skipping intraday", { symbol, iranDate });
    await saveEvent({
      symbol,
      event: "intraday_skip",
      message: "Setup already invalidated",
    });
    result.ok = true;
    result.skipped = true;
    result.reason = "invalidated";
    return result;
  }

  const bitunix1h = await fetchBitunixMarketData(symbol, { interval: "1h" });
  const research = await maybeScrapeResearch(symbol, options);
  const previousEval = await getLatestSetupEvaluation(dailySetup.id);

  const evaluation = await evaluateDailySetup({
    symbol,
    dailySetup,
    bitunix1h,
    researchText: research.text || "",
    previousEvaluation: previousEval?.evaluation || null,
  });

  await updateDailySetupStatus(
    dailySetup.id,
    evaluation.setup_status,
    evaluation.confidence,
    evaluation.market_score,
  );

  if (research.fingerprint && research.scrapeResult && !research.unchanged) {
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
    evaluation,
    bitunix_1h: bitunix1h,
    telegram_sent: true,
  });

  await saveEvent({
    symbol,
    event: "intraday_success",
    message: `status=${evaluation.setup_status} conf=${evaluation.confidence} research=${research.unchanged ? "unchanged_or_missing" : "new"}`,
  });

  result.ok = true;
  result.evaluation = evaluation;
  result.researchUnchanged = research.unchanged;
  return result;
}

async function runIntradayMonitor(options = {}) {
  logger.info("Start intraday monitor pipeline");
  await saveEvent({ event: "intraday_start", message: "Start intraday monitor pipeline" });

  const results = [];
  for (const symbol of config.coinex.symbols) {
    try {
      const result = await processIntradaySymbol(symbol, options);
      results.push(result);
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
