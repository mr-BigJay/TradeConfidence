const logger = require("../../logger");

const DEFAULT_FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
const DEFAULT_DATA = process.env.BINANCE_DATA_BASE || "https://fapi.binance.com";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctChange(from, to) {
  if (from === null || to === null || from === 0) return null;
  return Number((((to - from) / from) * 100).toFixed(4));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const msg = payload?.msg || text.slice(0, 180);
    const err = new Error(`Binance HTTP ${response.status}: ${msg}`);
    err.status = response.status;
    err.geoBlocked = response.status === 451 || /restricted location/i.test(msg);
    throw err;
  }

  if (payload && typeof payload === "object" && payload.code && payload.code !== 200 && payload.msg) {
    // Some Binance error bodies still return 200-like wrappers; treat explicit failures.
    if (String(payload.code) !== "0" && Number(payload.code) < 0) {
      throw new Error(`Binance error ${payload.code}: ${payload.msg}`);
    }
  }

  return payload;
}

async function safe(label, fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    logger.warn("Binance fetch failed", { label, error: error.message, geoBlocked: Boolean(error.geoBlocked) });
    return { ok: false, error: error.message, geoBlocked: Boolean(error.geoBlocked), data: null };
  }
}

function latest(series) {
  return Array.isArray(series) && series.length ? series[series.length - 1] : null;
}

function summarizeDepth(depth) {
  const asks = (depth?.asks || []).slice(0, 20).map(([p, q]) => ({ price: toNumber(p), qty: toNumber(q) }));
  const bids = (depth?.bids || []).slice(0, 20).map(([p, q]) => ({ price: toNumber(p), qty: toNumber(q) }));
  const askVol = asks.reduce((s, r) => s + (r.qty || 0), 0);
  const bidVol = bids.reduce((s, r) => s + (r.qty || 0), 0);
  const imbalance =
    askVol + bidVol > 0 ? Number((((bidVol - askVol) / (askVol + bidVol)) * 100).toFixed(2)) : null;
  return {
    bestAsk: asks[0]?.price ?? null,
    bestBid: bids[0]?.price ?? null,
    askVolumeTop20: Number(askVol.toFixed(4)),
    bidVolumeTop20: Number(bidVol.toFixed(4)),
    imbalancePercent: imbalance,
    bias:
      imbalance === null ? "unknown" : imbalance > 8 ? "bid_heavy" : imbalance < -8 ? "ask_heavy" : "balanced",
  };
}

function computeCvdFromAggTrades(trades = []) {
  let cvd = 0;
  let buy = 0;
  let sell = 0;
  for (const trade of trades) {
    const qty = toNumber(trade.q ?? trade.qty ?? trade.quantity) || 0;
    const isBuyerMaker = Boolean(trade.m ?? trade.isBuyerMaker);
    // On Binance aggTrades: m=true means buyer is maker => taker was seller
    if (isBuyerMaker) {
      sell += qty;
      cvd -= qty;
    } else {
      buy += qty;
      cvd += qty;
    }
  }
  return {
    cvd: Number(cvd.toFixed(4)),
    buyVolume: Number(buy.toFixed(4)),
    sellVolume: Number(sell.toFixed(4)),
    tradeCount: trades.length,
    bias: cvd > 0 ? "buy_pressure" : cvd < 0 ? "sell_pressure" : "neutral",
  };
}

/**
 * Binance USDT-M futures market reference snapshot.
 * Primary analysis source for futures positioning.
 */
async function fetchBinanceFuturesSnapshot(symbol = "BTCUSDT", options = {}) {
  const normalized = String(symbol || "BTCUSDT").trim().toUpperCase();
  const period = options.period || "1h";
  const fapi = (options.fapiBase || DEFAULT_FAPI).replace(/\/$/, "");
  const dataBase = (options.dataBase || DEFAULT_DATA).replace(/\/$/, "");

  const [
    premium,
    ticker,
    openInterest,
    fundingHistory,
    oiHist,
    globalLs,
    topAccountLs,
    topPositionLs,
    takerLs,
    depth,
    klines,
    aggTrades,
  ] = await Promise.all([
    safe("premiumIndex", () => fetchJson(`${fapi}/fapi/v1/premiumIndex?symbol=${normalized}`)),
    safe("ticker24h", () => fetchJson(`${fapi}/fapi/v1/ticker/24hr?symbol=${normalized}`)),
    safe("openInterest", () => fetchJson(`${fapi}/fapi/v1/openInterest?symbol=${normalized}`)),
    safe("fundingHistory", () =>
      fetchJson(`${fapi}/fapi/v1/fundingRate?symbol=${normalized}&limit=${options.fundingLimit || 12}`),
    ),
    safe("oiHist", () =>
      fetchJson(
        `${dataBase}/futures/data/openInterestHist?symbol=${normalized}&period=${period}&limit=30`,
      ),
    ),
    safe("globalLs", () =>
      fetchJson(
        `${dataBase}/futures/data/globalLongShortAccountRatio?symbol=${normalized}&period=${period}&limit=30`,
      ),
    ),
    safe("topAccountLs", () =>
      fetchJson(
        `${dataBase}/futures/data/topLongShortAccountRatio?symbol=${normalized}&period=${period}&limit=30`,
      ),
    ),
    safe("topPositionLs", () =>
      fetchJson(
        `${dataBase}/futures/data/topLongShortPositionRatio?symbol=${normalized}&period=${period}&limit=30`,
      ),
    ),
    safe("takerLs", () =>
      fetchJson(
        `${dataBase}/futures/data/takerlongshortRatio?symbol=${normalized}&period=${period}&limit=30`,
      ),
    ),
    safe("depth", () => fetchJson(`${fapi}/fapi/v1/depth?symbol=${normalized}&limit=20`)),
    safe("klines", () =>
      fetchJson(`${fapi}/fapi/v1/klines?symbol=${normalized}&interval=${period}&limit=120`),
    ),
    safe("aggTrades", () =>
      fetchJson(`${fapi}/fapi/v1/aggTrades?symbol=${normalized}&limit=${options.aggLimit || 500}`),
    ),
  ]);

  const geoBlocked = [
    premium,
    ticker,
    openInterest,
    fundingHistory,
    oiHist,
    globalLs,
    topAccountLs,
    topPositionLs,
    takerLs,
    depth,
    klines,
    aggTrades,
  ].some((item) => item.geoBlocked);

  const premiumData = premium.data || {};
  const tickerData = ticker.data || {};
  const oiNow = toNumber(openInterest.data?.openInterest);
  const oiSeries = Array.isArray(oiHist.data) ? oiHist.data : [];
  const oiLatest = latest(oiSeries);
  const oiPrev = oiSeries.length > 1 ? oiSeries[oiSeries.length - 2] : null;

  const globalLatest = latest(Array.isArray(globalLs.data) ? globalLs.data : []);
  const topAccLatest = latest(Array.isArray(topAccountLs.data) ? topAccountLs.data : []);
  const topPosLatest = latest(Array.isArray(topPositionLs.data) ? topPositionLs.data : []);
  const takerLatest = latest(Array.isArray(takerLs.data) ? takerLs.data : []);
  const fundingSeries = Array.isArray(fundingHistory.data) ? fundingHistory.data : [];
  const fundingLatest = latest(fundingSeries);

  const markPrice = toNumber(premiumData.markPrice) ?? toNumber(tickerData.lastPrice);
  const indexPrice = toNumber(premiumData.indexPrice);
  const lastPrice = toNumber(tickerData.lastPrice) ?? markPrice;
  const basis =
    markPrice !== null && indexPrice ? Number((((markPrice - indexPrice) / indexPrice) * 100).toFixed(4)) : null;

  const cvd = computeCvdFromAggTrades(Array.isArray(aggTrades.data) ? aggTrades.data : []);
  const orderBook = summarizeDepth(depth.data || {});

  const candleRows = Array.isArray(klines.data)
    ? klines.data.map((row) => ({
        time: Number(row[0]),
        open: toNumber(row[1]),
        high: toNumber(row[2]),
        low: toNumber(row[3]),
        close: toNumber(row[4]),
        volume: toNumber(row[5]),
        quoteVolume: toNumber(row[7]),
        takerBuyBase: toNumber(row[9]),
        takerBuyQuote: toNumber(row[10]),
      }))
    : [];

  const available =
    premium.ok ||
    ticker.ok ||
    openInterest.ok ||
    oiHist.ok ||
    globalLs.ok ||
    topPositionLs.ok ||
    aggTrades.ok;

  const snapshot = {
    source: "binance_futures",
    role: "market_reference",
    symbol: normalized,
    period,
    fetchedAt: new Date().toISOString(),
    available,
    geoBlocked,
    lastPrice,
    markPrice,
    indexPrice,
    basisPercent: basis,
    high24h: toNumber(tickerData.highPrice),
    low24h: toNumber(tickerData.lowPrice),
    volume24h: toNumber(tickerData.volume),
    quoteVolume24h: toNumber(tickerData.quoteVolume),
    change24hPercent: toNumber(tickerData.priceChangePercent),
    fundingRate: toNumber(premiumData.lastFundingRate) ?? toNumber(fundingLatest?.fundingRate),
    fundingRatePercent:
      toNumber(premiumData.lastFundingRate) !== null
        ? Number((toNumber(premiumData.lastFundingRate) * 100).toFixed(4))
        : toNumber(fundingLatest?.fundingRate) !== null
          ? Number((toNumber(fundingLatest.fundingRate) * 100).toFixed(4))
          : null,
    nextFundingTime: premiumData.nextFundingTime
      ? new Date(Number(premiumData.nextFundingTime)).toISOString()
      : null,
    fundingHistory: fundingSeries.slice(-8).map((row) => ({
      time: row.fundingTime,
      ratePercent: toNumber(row.fundingRate) !== null ? Number((toNumber(row.fundingRate) * 100).toFixed(4)) : null,
    })),
    openInterest: {
      latest: oiNow ?? toNumber(oiLatest?.sumOpenInterest),
      valueUsdt: toNumber(oiLatest?.sumOpenInterestValue),
      previous: toNumber(oiPrev?.sumOpenInterest),
      changePercent: pctChange(
        toNumber(oiPrev?.sumOpenInterest),
        oiNow ?? toNumber(oiLatest?.sumOpenInterest),
      ),
      trend:
        pctChange(toNumber(oiPrev?.sumOpenInterest), oiNow ?? toNumber(oiLatest?.sumOpenInterest)) >
        1
          ? "up"
          : pctChange(toNumber(oiPrev?.sumOpenInterest), oiNow ?? toNumber(oiLatest?.sumOpenInterest)) <
              -1
            ? "down"
            : "flat",
    },
    globalLongShort: {
      ratio: toNumber(globalLatest?.longShortRatio),
      longAccount: toNumber(globalLatest?.longAccount),
      shortAccount: toNumber(globalLatest?.shortAccount),
    },
    topTraderAccounts: {
      ratio: toNumber(topAccLatest?.longShortRatio),
      longAccount: toNumber(topAccLatest?.longAccount),
      shortAccount: toNumber(topAccLatest?.shortAccount),
    },
    topTraderPositions: {
      ratio: toNumber(topPosLatest?.longShortRatio),
      longAccount: toNumber(topPosLatest?.longAccount),
      shortAccount: toNumber(topPosLatest?.shortAccount),
    },
    takerBuySell: {
      buySellRatio: toNumber(takerLatest?.buySellRatio),
      buyVol: toNumber(takerLatest?.buyVol),
      sellVol: toNumber(takerLatest?.sellVol),
    },
    orderBook,
    cvd,
    candles: candleRows.slice(-48),
    errors: {
      premium: premium.error || null,
      ticker: ticker.error || null,
      openInterest: openInterest.error || null,
      fundingHistory: fundingHistory.error || null,
      oiHist: oiHist.error || null,
      globalLs: globalLs.error || null,
      topAccountLs: topAccountLs.error || null,
      topPositionLs: topPositionLs.error || null,
      takerLs: takerLs.error || null,
      depth: depth.error || null,
      klines: klines.error || null,
      aggTrades: aggTrades.error || null,
    },
  };

  snapshot.checklistText = [
    `Source: Binance Futures (${normalized})`,
    `Available: ${available} | GeoBlocked: ${geoBlocked}`,
    `Price: ${lastPrice ?? "n/a"} | Mark: ${markPrice ?? "n/a"} | Index: ${indexPrice ?? "n/a"} | Basis: ${basis ?? "n/a"}%`,
    `24h: ${snapshot.change24hPercent ?? "n/a"}% high=${snapshot.high24h ?? "n/a"} low=${snapshot.low24h ?? "n/a"} volQuote=${snapshot.quoteVolume24h ?? "n/a"}`,
    `Funding: ${snapshot.fundingRatePercent ?? "n/a"}% next=${snapshot.nextFundingTime || "n/a"}`,
    `OI: ${snapshot.openInterest.latest ?? "n/a"} valueUSDT=${snapshot.openInterest.valueUsdt ?? "n/a"} trend=${snapshot.openInterest.trend} change=${snapshot.openInterest.changePercent ?? "n/a"}%`,
    `Global L/S: ${snapshot.globalLongShort.ratio ?? "n/a"}`,
    `TopTrader Accounts L/S: ${snapshot.topTraderAccounts.ratio ?? "n/a"}`,
    `TopTrader Positions L/S: ${snapshot.topTraderPositions.ratio ?? "n/a"}`,
    `Taker buy/sell ratio: ${snapshot.takerBuySell.buySellRatio ?? "n/a"}`,
    `OrderBook imbalance: ${orderBook.imbalancePercent ?? "n/a"}% (${orderBook.bias})`,
    `CVD(recent aggTrades): ${cvd.cvd} bias=${cvd.bias} buy=${cvd.buyVolume} sell=${cvd.sellVolume}`,
  ].join("\n");

  logger.info("Binance futures snapshot fetched", {
    symbol: normalized,
    available,
    geoBlocked,
    price: lastPrice,
    funding: snapshot.fundingRatePercent,
    oiTrend: snapshot.openInterest.trend,
  });

  return snapshot;
}

module.exports = {
  fetchBinanceFuturesSnapshot,
  computeCvdFromAggTrades,
};
