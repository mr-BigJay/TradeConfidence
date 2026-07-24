const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config/config");
const {
  getLatestContent,
  saveAnalysis,
  saveContent,
  saveEvent,
} = require("../database/db");
const logger = require("../logger");
const { scrapeAiResearch } = require("../playwright/scraper");
const { analyzeAiResearch } = require("./openai");
const { renderCard } = require("./cardRenderer");
const { sendMarketStatus } = require("./telegram");
const { buildContentFingerprint, isSameResearch } = require("./contentFingerprint");

function safeTimestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function saveScrapeOutput(scrapeResult) {
  await fs.mkdir("output", { recursive: true });

  const filePath = path.join(
    "output",
    `${scrapeResult.symbol}-${safeTimestampForFile(new Date(scrapeResult.datetime))}.json`,
  );

  await fs.writeFile(filePath, `${JSON.stringify(scrapeResult, null, 2)}\n`, "utf8");
  return filePath;
}

async function processSymbol(symbol, options = {}) {
  const result = {
    symbol,
    ok: false,
    skipped: false,
  };

  try {
    logger.info("Start symbol processing", { symbol });
    await saveEvent({ symbol, event: "start", message: "Start symbol processing" });

    const scrapeResult = await scrapeAiResearch(symbol);
    logger.info("Extract success", { symbol, length: scrapeResult.text.length });
    await saveEvent({ symbol, event: "extract_success", message: `Length: ${scrapeResult.text.length}` });

    const outputPath = await saveScrapeOutput(scrapeResult);
    logger.info("Saved scrape output", { symbol, outputPath });

    if (options.scrapeOnly) {
      result.ok = true;
      result.outputPath = outputPath;
      return result;
    }

    const fingerprint = buildContentFingerprint(scrapeResult.text);
    const latestContent = await getLatestContent(symbol);

    logger.info("Research fingerprint", {
      symbol,
      sourceUpdatedAt: fingerprint.sourceUpdatedAt,
      contentHash: fingerprint.contentHash.slice(0, 12),
      previousHash: latestContent?.text_hash?.slice(0, 12) || null,
      previousSourceUpdatedAt: latestContent?.source_updated_at || null,
    });

    // Production rule: only analyze/send when CoinEx AI Research is actually new.
    if (!options.force && isSameResearch(latestContent, fingerprint)) {
      logger.info("No new AI Research. Skipping GPT, card, and Telegram.", {
        symbol,
        sourceUpdatedAt: fingerprint.sourceUpdatedAt,
      });
      await saveEvent({
        symbol,
        event: "no_change",
        message: fingerprint.sourceUpdatedAt
          ? `AI Research unchanged (Time: ${fingerprint.sourceUpdatedAt})`
          : "AI Research content hash unchanged",
      });
      result.ok = true;
      result.skipped = true;
      result.reason = "no_change";
      return result;
    }

    if (options.force) {
      logger.warn("Force mode enabled: regenerating even if AI Research is unchanged", { symbol });
    }

    await saveContent({
      symbol,
      textHash: fingerprint.contentHash,
      rawText: scrapeResult.text,
      scrapedAt: scrapeResult.datetime,
      sourceUpdatedAt: fingerprint.sourceUpdatedAt,
    });

    const analysis = await analyzeAiResearch({
      symbol,
      text: scrapeResult.text,
    });
    logger.info("GPT success", { symbol });
    await saveEvent({ symbol, event: "gpt_success", message: "OpenAI analysis created" });

    await saveAnalysis({
      symbol,
      textHash: fingerprint.contentHash,
      analysis,
      createdAt: new Date().toISOString(),
    });

    let imagePath = null;
    try {
      imagePath = await renderCard(analysis);
      logger.info("Card image success", { symbol, imagePath, mode: config.runtime.cardMode });
      await saveEvent({ symbol, event: "card_success", message: `${config.runtime.cardMode}:${imagePath}` });
    } catch (error) {
      logger.error("Card image failed, falling back to text-only Telegram", {
        symbol,
        error: error.message,
      });
      await saveEvent({ symbol, event: "card_error", message: error.message });
    }

    await sendMarketStatus(analysis, imagePath);
    logger.info("Telegram success", { symbol, hasImage: Boolean(imagePath) });
    await saveEvent({
      symbol,
      event: "telegram_success",
      message: imagePath ? `Telegram photo sent: ${imagePath}` : "Telegram text sent",
    });

    result.ok = true;
    result.analysis = analysis;
    result.imagePath = imagePath;
    return result;
  } catch (error) {
    logger.error("Symbol processing failed", {
      symbol,
      error: error.message,
      stack: error.stack,
    });
    await saveEvent({
      symbol,
      event: "error",
      message: error.message,
    }).catch((dbError) => {
      logger.error("Failed to save error event", { symbol, error: dbError.message });
    });

    result.error = error.message;
    return result;
  } finally {
    logger.info("Finish symbol processing", { symbol });
  }
}

async function runPipeline(options = {}) {
  logger.info("Start CoinEx AI Research pipeline");
  await saveEvent({ event: "pipeline_start", message: "Start CoinEx AI Research pipeline" });

  const results = [];

  for (const symbol of config.coinex.symbols) {
    const result = await processSymbol(symbol, options);
    results.push(result);
  }

  logger.info("Finish CoinEx AI Research pipeline", { results });
  await saveEvent({
    event: "pipeline_finish",
    message: JSON.stringify(results.map(({ symbol, ok, skipped, error }) => ({ symbol, ok, skipped, error }))),
  });

  return results;
}

module.exports = {
  processSymbol,
  runPipeline,
};
