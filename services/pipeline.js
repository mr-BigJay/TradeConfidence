const crypto = require("node:crypto");
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
const { renderAnalysisCard } = require("./cardImage");
const { sendMarketStatus } = require("./telegram");

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

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

    const textHash = hashText(scrapeResult.text);
    const latestContent = await getLatestContent(symbol);

    if (!options.force && latestContent?.text_hash === textHash) {
      logger.info("AI Research unchanged, skipping OpenAI and Telegram", { symbol });
      await saveEvent({ symbol, event: "no_change", message: "AI Research text has not changed" });
      result.ok = true;
      result.skipped = true;
      result.reason = "no_change";
      return result;
    }

    await saveContent({
      symbol,
      textHash,
      rawText: scrapeResult.text,
      scrapedAt: scrapeResult.datetime,
    });

    const analysis = await analyzeAiResearch({
      symbol,
      text: scrapeResult.text,
    });
    logger.info("GPT success", { symbol });
    await saveEvent({ symbol, event: "gpt_success", message: "OpenAI analysis created" });

    await saveAnalysis({
      symbol,
      textHash,
      analysis,
      createdAt: new Date().toISOString(),
    });

    let imagePath = null;
    try {
      imagePath = await renderAnalysisCard(analysis);
      logger.info("Card image success", { symbol, imagePath });
      await saveEvent({ symbol, event: "card_success", message: imagePath });
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
