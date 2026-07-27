const logger = require("../logger");
const { scrapeAiResearch } = require("../playwright/scraper");
const {
  fetchBinanceFuturesSnapshot,
  fetchBinanceMultiTimeframeCandles,
} = require("./providers/binanceFutures");
const { fetchDeribitOptionsSnapshot } = require("./providers/deribitOptions");
const {
  fetchBitunixExecutionSnapshot,
  compareExecutionVenue,
} = require("./providers/bitunixExecution");
const { analyzeChartIntelligence } = require("./chart/analyzeChart");
const { getLatestContent, saveContent } = require("../database/db");
const { buildContentFingerprint } = require("./contentFingerprint");

/**
 * Exchange-agnostic normalized market bundle for scoring/validation.
 */
function normalizeMarketBundle({
  symbol,
  coinex = null,
  binance = null,
  deribit = null,
  bitunix = null,
  executionCompare = null,
  chart = null,
}) {
  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    coinex: coinex
      ? {
          source: coinex.source || "coinex",
          role: "market_narrative",
          available: Boolean(coinex.text && String(coinex.text).trim().length > 40),
          text: coinex.text || "",
          url: coinex.url || null,
          scrapedAt: coinex.datetime || coinex.scrapedAt || null,
          fromCache: Boolean(coinex.fromCache),
          error: coinex.error || null,
        }
      : { source: "coinex", role: "market_narrative", available: false, text: "" },
    futures: {
      source: "binance_futures",
      role: "market_reference",
      available: Boolean(binance?.available),
      price: binance?.lastPrice ?? null,
      markPrice: binance?.markPrice ?? null,
      indexPrice: binance?.indexPrice ?? null,
      fundingRatePercent: binance?.fundingRatePercent ?? null,
      openInterest: binance?.openInterest || null,
      longShortRatio: binance?.globalLongShort?.ratio ?? null,
      topTraderPositionRatio: binance?.topTraderPositions?.ratio ?? null,
      takerBuySellRatio: binance?.takerBuySell?.buySellRatio ?? null,
      cvd: binance?.cvd || null,
      orderBook: binance?.orderBook || null,
      volume24hQuote: binance?.quoteVolume24h ?? null,
      change24hPercent: binance?.change24hPercent ?? null,
      high24h: binance?.high24h ?? null,
      low24h: binance?.low24h ?? null,
      basisPercent: binance?.basisPercent ?? null,
      geoBlocked: Boolean(binance?.geoBlocked),
      checklistText: binance?.checklistText || "",
      raw: binance,
    },
    options: {
      source: "deribit_options",
      role: "options_intelligence",
      available: Boolean(deribit?.available),
      spot: deribit?.spot ?? null,
      putCallRatio: deribit?.putCall?.oiPutCallRatio ?? null,
      maxPain: deribit?.maxPain?.maxPain ?? null,
      atmIv: deribit?.iv?.atmIv ?? null,
      skew: deribit?.iv?.skew ?? null,
      dealerGammaBias: deribit?.dealer?.gammaBias ?? null,
      checklistText: deribit?.checklistText || "",
      raw: deribit,
    },
    execution: {
      source: "bitunix_execution",
      role: "execution_venue",
      available: Boolean(bitunix?.available),
      price: bitunix?.lastPrice ?? null,
      fundingRatePercent: bitunix?.fundingRatePercent ?? null,
      openInterest: bitunix?.openInterest || null,
      orderBook: bitunix?.orderBook || null,
      compare: executionCompare,
      checklistText: bitunix?.checklistText || "",
      raw: bitunix,
    },
    chart: chart || {
      source: "chart_intelligence",
      role: "technical_chart_analysis",
      available: false,
      checklistText: "Chart intelligence unavailable",
    },
  };
}

function bundleToPromptText(bundle) {
  const narrative = bundle.coinex?.available
    ? bundle.coinex.text
    : `CoinEx research unavailable${bundle.coinex?.error ? ` (${bundle.coinex.error})` : ""}. Do NOT invent a CoinEx narrative. Leave coinex_summary empty or say scrape failed, and rely on Futures/Options/Chart.`;

  return [
    "=== CoinEx Narrative (PRIMARY TEXT ANALYSIS — use this if present) ===",
    narrative,
    "",
    "=== Binance Futures Reference ===",
    bundle.futures?.checklistText || "Binance futures unavailable",
    "",
    "=== Deribit Options ===",
    bundle.options?.checklistText || "Deribit options unavailable",
    "",
    "=== Chart Technical Intelligence ===",
    bundle.chart?.checklistText || "Chart intelligence unavailable",
    "",
    "=== Bitunix Execution Venue ===",
    bundle.execution?.checklistText || "Bitunix execution data unavailable",
    "",
    "=== Venue Divergence Notes ===",
    ...(bundle.execution?.compare?.notes || ["n/a"]),
    "",
    "=== Chart Setup Rule ===",
    bundle.chart?.setup?.rule ||
      "Pattern alone never creates a trade. Need Market + Technical + Risk confirmations.",
  ].join("\n");
}

async function loadCachedResearch(symbol) {
  try {
    const latest = await getLatestContent(symbol);
    if (!latest?.raw_text || String(latest.raw_text).trim().length < 80) return null;
    return {
      source: "coinex_cache",
      text: latest.raw_text,
      datetime: latest.scraped_at || null,
      url: null,
      fromCache: true,
    };
  } catch (error) {
    logger.warn("Failed loading cached CoinEx research", { symbol, error: error.message });
    return null;
  }
}

async function persistResearch(symbol, scrape) {
  if (!scrape?.text || scrape.fromCache) return;
  try {
    const fingerprint = buildContentFingerprint(scrape.text);
    await saveContent({
      symbol,
      textHash: fingerprint.contentHash,
      rawText: scrape.text,
      scrapedAt: scrape.datetime || new Date().toISOString(),
      sourceUpdatedAt: fingerprint.sourceUpdatedAt,
    });
  } catch (error) {
    logger.warn("Failed saving CoinEx research to DB", { symbol, error: error.message });
  }
}

async function collectCoinExResearch(symbol) {
  try {
    const scrape = await scrapeAiResearch(symbol, { retries: 2 });
    await persistResearch(symbol, scrape);
    return scrape;
  } catch (error) {
    logger.warn("CoinEx research scrape failed; trying DB cache", { error: error.message });
    const cached = await loadCachedResearch(symbol);
    if (cached) {
      logger.info("Using cached CoinEx research", {
        symbol,
        length: cached.text.length,
        scrapedAt: cached.datetime,
      });
      return { ...cached, error: error.message };
    }
    return { text: "", datetime: null, url: null, error: error.message };
  }
}

async function collectMarketBundle(symbol, options = {}) {
  const includeResearch = options.includeResearch !== false;
  const includeChart = options.includeChart !== false;
  const period = options.period || "1h";

  // Scrape CoinEx FIRST (Chromium is heavy). Avoid racing it with other fetches.
  let coinex = null;
  if (includeResearch) {
    coinex = await collectCoinExResearch(symbol);
  }

  const tasks = {
    binance: fetchBinanceFuturesSnapshot(symbol, { period }).catch((error) => {
      logger.warn("Binance bundle fetch failed", { error: error.message });
      return {
        source: "binance_futures",
        available: false,
        geoBlocked: Boolean(error.geoBlocked),
        checklistText: `Binance unavailable: ${error.message}`,
        errors: { fatal: error.message },
      };
    }),
    deribit: fetchDeribitOptionsSnapshot({ currency: "BTC" }).catch((error) => {
      logger.warn("Deribit bundle fetch failed", { error: error.message });
      return {
        source: "deribit_options",
        available: false,
        checklistText: `Deribit unavailable: ${error.message}`,
      };
    }),
    bitunix: fetchBitunixExecutionSnapshot(symbol, { interval: period }).catch((error) => {
      logger.warn("Bitunix execution fetch failed", { error: error.message });
      return {
        source: "bitunix_execution",
        available: false,
        checklistText: `Bitunix unavailable: ${error.message}`,
      };
    }),
  };

  if (includeChart) {
    tasks.candles = fetchBinanceMultiTimeframeCandles(symbol).catch((error) => {
      logger.warn("Multi-TF candles failed", { error: error.message });
      return {};
    });
  }

  const settled = {};
  await Promise.all(
    Object.entries(tasks).map(async ([key, promise]) => {
      settled[key] = await promise;
    }),
  );

  const executionCompare = compareExecutionVenue(settled.binance, settled.bitunix);

  let chart = null;
  if (includeChart) {
    let liquidations = [];
    try {
      const { getWsState } = require("./providers/binanceWsCollector");
      liquidations = getWsState()?.liquidations || [];
    } catch {
      liquidations = [];
    }
    chart = analyzeChartIntelligence(settled.candles || {}, {
      fundingRatePercent: settled.binance?.fundingRatePercent,
      openInterest: settled.binance?.openInterest,
      cvd: settled.binance?.cvd,
      orderBook: settled.binance?.orderBook,
      high24h: settled.binance?.high24h,
      low24h: settled.binance?.low24h,
      liquidations,
    });
    logger.info("Chart intelligence ready", {
      symbol,
      available: chart.available,
      direction: chart.setup?.direction,
      tradeAllowed: chart.setup?.trade_allowed,
      topPattern: chart.top_pattern?.name || null,
    });
  }

  const bundle = normalizeMarketBundle({
    symbol,
    coinex: includeResearch ? coinex : null,
    binance: settled.binance,
    deribit: settled.deribit,
    bitunix: settled.bitunix,
    executionCompare,
    chart,
  });

  logger.info("Market bundle narrative status", {
    symbol,
    coinexAvailable: bundle.coinex?.available,
    coinexFromCache: Boolean(bundle.coinex?.fromCache),
    coinexLength: bundle.coinex?.text?.length || 0,
    coinexError: bundle.coinex?.error || null,
  });

  bundle.promptText = bundleToPromptText(bundle);
  return bundle;
}

module.exports = {
  collectMarketBundle,
  normalizeMarketBundle,
  bundleToPromptText,
  collectCoinExResearch,
};
