const logger = require("../logger");
const { scrapeAiResearch } = require("../playwright/scraper");
const { fetchBinanceFuturesSnapshot } = require("./providers/binanceFutures");
const { fetchDeribitOptionsSnapshot } = require("./providers/deribitOptions");
const {
  fetchBitunixExecutionSnapshot,
  compareExecutionVenue,
} = require("./providers/bitunixExecution");

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
}) {
  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    coinex: coinex
      ? {
          source: "coinex",
          role: "market_narrative",
          available: Boolean(coinex.text),
          text: coinex.text || "",
          url: coinex.url || null,
          scrapedAt: coinex.datetime || null,
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
  };
}

function bundleToPromptText(bundle) {
  return [
    "=== CoinEx Narrative ===",
    bundle.coinex?.available ? bundle.coinex.text : "CoinEx research unavailable",
    "",
    "=== Binance Futures Reference ===",
    bundle.futures?.checklistText || "Binance futures unavailable",
    "",
    "=== Deribit Options ===",
    bundle.options?.checklistText || "Deribit options unavailable",
    "",
    "=== Bitunix Execution Venue ===",
    bundle.execution?.checklistText || "Bitunix execution data unavailable",
    "",
    "=== Venue Divergence Notes ===",
    ...(bundle.execution?.compare?.notes || ["n/a"]),
  ].join("\n");
}

async function collectMarketBundle(symbol, options = {}) {
  const includeResearch = options.includeResearch !== false;
  const period = options.period || "1h";

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

  if (includeResearch) {
    tasks.coinex = scrapeAiResearch(symbol)
      .then((scrape) => scrape)
      .catch((error) => {
        logger.warn("CoinEx research scrape failed", { error: error.message });
        return { text: "", datetime: null, url: null, error: error.message };
      });
  }

  const settled = {};
  await Promise.all(
    Object.entries(tasks).map(async ([key, promise]) => {
      settled[key] = await promise;
    }),
  );

  const executionCompare = compareExecutionVenue(settled.binance, settled.bitunix);
  const bundle = normalizeMarketBundle({
    symbol,
    coinex: includeResearch ? settled.coinex : null,
    binance: settled.binance,
    deribit: settled.deribit,
    bitunix: settled.bitunix,
    executionCompare,
  });

  bundle.promptText = bundleToPromptText(bundle);
  return bundle;
}

module.exports = {
  collectMarketBundle,
  normalizeMarketBundle,
  bundleToPromptText,
};
