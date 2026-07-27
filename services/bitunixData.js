const logger = require("../logger");
const { summarizeIndicators, indicatorsToText } = require("./indicators");

const API_BASE = "https://api.bitunix.com";
const FAPI_BASE = "https://fapi.bitunix.com";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctChange(from, to) {
  if (from === null || to === null || from === 0) {
    return null;
  }
  return ((to - from) / from) * 100;
}

function trendFromSeries(values) {
  if (!values.length) {
    return "flat";
  }
  if (values.length === 1) {
    return "flat";
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (first === null || last === null || first === 0) {
    return "flat";
  }
  const change = ((last - first) / first) * 100;
  if (change > 1) {
    return "up";
  }
  if (change < -1) {
    return "down";
  }
  return "flat";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Bitunix HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function unwrapData(payload, label) {
  if (!payload || (payload.code !== 0 && payload.code !== "0")) {
    throw new Error(`Bitunix ${label} failed: ${payload?.msg || "unknown error"}`);
  }
  return payload.data;
}

function latestPoint(series) {
  return Array.isArray(series) && series.length ? series[series.length - 1] : null;
}

function previousPoint(series) {
  return Array.isArray(series) && series.length > 1 ? series[series.length - 2] : null;
}

function summarizeLiquidationMap(liquidations, lastPrice) {
  if (!Array.isArray(liquidations) || lastPrice === null) {
    return {
      aboveClusters: [],
      belowClusters: [],
      note: "نقشه لیکویید در دسترس نیست",
    };
  }

  const rows = liquidations
    .map((row) => {
      const price = toNumber(row.price);
      const intensity = (row.priceArray || []).reduce(
        (sum, item) => sum + (toNumber(item.intensity) || 0),
        0,
      );
      return { price, intensity };
    })
    .filter((row) => row.price !== null && row.intensity > 0);

  const above = rows
    .filter((row) => row.price > lastPrice)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 5);
  const below = rows
    .filter((row) => row.price < lastPrice)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 5);

  return {
    aboveClusters: above.map((row) => ({
      price: String(row.price),
      intensityUsd: Number(row.intensity.toFixed(0)),
    })),
    belowClusters: below.map((row) => ({
      price: String(row.price),
      intensityUsd: Number(row.intensity.toFixed(0)),
    })),
    note:
      above.length || below.length
        ? "خوشه‌های قوی‌تر لیکویید بالا/پایین قیمت فعلی استخراج شد"
        : "خوشه قابل‌توجهی یافت نشد",
  };
}

function formatFundingPercent(rawRate) {
  const rate = toNumber(rawRate);
  if (rate === null) {
    return null;
  }

  // Bitunix fapi returns funding already in percent units
  // (e.g. 0.009469 means 0.009469%), matching the Data tab UI.
  return Number(rate.toFixed(4));
}

function summarizeOrderBook(asks, bids, lastPrice) {
  const topAsks = (asks || [])
    .slice(0, 10)
    .map(([price, qty]) => ({ price: toNumber(price), qty: toNumber(qty) }))
    .filter((row) => row.price !== null && row.qty !== null);
  const topBids = (bids || [])
    .slice(0, 10)
    .map(([price, qty]) => ({ price: toNumber(price), qty: toNumber(qty) }))
    .filter((row) => row.price !== null && row.qty !== null);

  const askVol = topAsks.reduce((sum, row) => sum + row.qty, 0);
  const bidVol = topBids.reduce((sum, row) => sum + row.qty, 0);
  const imbalance =
    askVol + bidVol > 0 ? Number((((bidVol - askVol) / (bidVol + askVol)) * 100).toFixed(2)) : null;

  return {
    bestAsk: topAsks[0]?.price ?? null,
    bestBid: topBids[0]?.price ?? null,
    askVolumeTop10: Number(askVol.toFixed(4)),
    bidVolumeTop10: Number(bidVol.toFixed(4)),
    imbalancePercent: imbalance,
    bias:
      imbalance === null ? "نامشخص" : imbalance > 8 ? "خریداران قوی‌تر" : imbalance < -8 ? "فروشندگان قوی‌تر" : "متعادل",
    lastPrice,
  };
}

function buildChecklistText(snapshot) {
  const candle = snapshot.dailyCandle || snapshot.lastCandle || {};
  const book = snapshot.orderBook || {};
  const lines = [
    `Symbol: ${snapshot.symbol}`,
    `Timeframe: ${snapshot.interval}`,
    `Last price: ${snapshot.lastPrice ?? "n/a"}`,
    `24h high/low: ${snapshot.high24h ?? "n/a"} / ${snapshot.low24h ?? "n/a"}`,
    `24h change: ${snapshot.change24hPercent ?? "n/a"}%`,
    `Volume 24h USDT: ${snapshot.volume24hUsdt ?? "n/a"}`,
    `Daily/last candle O/H/L/C: ${candle.open ?? "n/a"} / ${candle.high ?? "n/a"} / ${candle.low ?? "n/a"} / ${candle.close ?? "n/a"}`,
    `Mark: ${snapshot.markPrice ?? "n/a"} | Index: ${snapshot.indexPrice ?? "n/a"}`,
    `Funding rate: ${snapshot.fundingRatePercent ?? "n/a"}% | Next funding: ${snapshot.nextFundingTime || "n/a"}`,
    `Open Interest (coin): ${snapshot.openInterest.latest ?? "n/a"} (prev ${snapshot.openInterest.previous ?? "n/a"}) trend=${snapshot.openInterest.trend} change≈${snapshot.openInterest.changeFromPreviousPercent ?? "n/a"}%`,
    `Open Interest value USDT: ${snapshot.openInterest.latestValueUsdt ?? "n/a"}`,
    `Long/Short Accounts ratio: ${snapshot.globalLongShortAccounts.ratio ?? "n/a"} (L ${snapshot.globalLongShortAccounts.longPercent ?? "n/a"}% / S ${snapshot.globalLongShortAccounts.shortPercent ?? "n/a"}%) trend=${snapshot.globalLongShortAccounts.trend}`,
    `Top Trader Accounts ratio: ${snapshot.topTraderAccounts.ratio ?? "n/a"} (L ${snapshot.topTraderAccounts.longPercent ?? "n/a"}% / S ${snapshot.topTraderAccounts.shortPercent ?? "n/a"}%) trend=${snapshot.topTraderAccounts.trend}`,
    `Top Trader Positions ratio: ${snapshot.topTraderPositions.ratio ?? "n/a"} (L ${snapshot.topTraderPositions.longPercent ?? "n/a"}% / S ${snapshot.topTraderPositions.shortPercent ?? "n/a"}%) trend=${snapshot.topTraderPositions.trend}`,
    `Order book imbalance: ${book.imbalancePercent ?? "n/a"}% (${book.bias || "n/a"}) bidVol=${book.bidVolumeTop10 ?? "n/a"} askVol=${book.askVolumeTop10 ?? "n/a"}`,
    `Liquidation above: ${
      snapshot.liquidationMap.aboveClusters
        .map((c) => `${c.price}≈$${c.intensityUsd}`)
        .join(", ") || "n/a"
    }`,
    `Liquidation below: ${
      snapshot.liquidationMap.belowClusters
        .map((c) => `${c.price}≈$${c.intensityUsd}`)
        .join(", ") || "n/a"
    }`,
  ];

  if (snapshot.indicatorsText) {
    lines.push("Indicators:", snapshot.indicatorsText);
  }

  return lines.join("\n");
}

async function fetchBitunixKlines(symbol, interval = "1h", limit = 120) {
  const normalized = String(symbol || "BTCUSDT").trim().toUpperCase();
  const payload = await fetchJson(
    `${FAPI_BASE}/api/v1/futures/market/kline?symbol=${normalized}&interval=${interval}&limit=${limit}`,
  );
  const rows = unwrapData(payload, "kline") || [];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      // Bitunix may return objects or arrays depending on version.
      if (Array.isArray(row)) {
        return {
          time: Number(row[0]),
          open: toNumber(row[1]),
          high: toNumber(row[2]),
          low: toNumber(row[3]),
          close: toNumber(row[4]),
          volume: toNumber(row[5]),
        };
      }
      return {
        time: toNumber(row.time || row.openTime || row.t),
        open: toNumber(row.open ?? row.o),
        high: toNumber(row.high ?? row.h),
        low: toNumber(row.low ?? row.l),
        close: toNumber(row.close ?? row.c),
        volume: toNumber(row.volume ?? row.baseVol ?? row.quoteVol ?? row.v),
      };
    })
    .filter((row) => row.close !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));
}

async function fetchBitunixOrderBook(symbol, limit = 15) {
  const normalized = String(symbol || "BTCUSDT").trim().toUpperCase();
  const payload = await fetchJson(
    `${FAPI_BASE}/api/v1/futures/market/depth?symbol=${normalized}&limit=${limit}`,
  );
  const data = unwrapData(payload, "depth") || {};
  return {
    asks: data.asks || data.a || [],
    bids: data.bids || data.b || [],
  };
}

async function fetchBitunixMarketData(symbol, options = {}) {
  const normalized = String(symbol || "BTCUSDT").trim().toUpperCase();
  const interval = options.interval || "1h";
  const lower = normalized.toLowerCase();
  const klineLimit = options.klineLimit || (interval === "1d" ? 120 : 120);
  const liqRange = options.liqRange || (interval === "1d" ? "7d" : "1d");

  const [
    fundingPayload,
    tickerPayload,
    oiPayload,
    globalLsPayload,
    topAccountPayload,
    topPositionPayload,
    liqPayload,
    klines,
    orderBookRaw,
  ] = await Promise.all([
    fetchJson(`${FAPI_BASE}/api/v1/futures/market/funding_rate?symbol=${normalized}`),
    fetchJson(`${FAPI_BASE}/api/v1/futures/market/tickers?symbols=${normalized}`),
    fetchJson(
      `${API_BASE}/innovation/basic/data/openInterest/history?symbol=${normalized}&interval=${interval}`,
    ),
    fetchJson(
      `${API_BASE}/innovation/basic/data/globalLongShortAccountRatio/history?symbol=${normalized}&interval=${interval}`,
    ),
    fetchJson(
      `${API_BASE}/innovation/basic/data/topLongShortAccountRatio/history?symbol=${normalized}&interval=${interval}`,
    ),
    fetchJson(
      `${API_BASE}/innovation/basic/data/topLongShortPositionRatio/history?symbol=${normalized}&interval=${interval}`,
    ),
    fetchJson(
      `${API_BASE}/innovation/basic/data/liquidation/map?symbol=${lower}&range=${liqRange}`,
    ),
    fetchBitunixKlines(normalized, interval, klineLimit).catch((error) => {
      logger.warn("Bitunix klines failed", { symbol: normalized, error: error.message });
      return [];
    }),
    fetchBitunixOrderBook(normalized, 15).catch((error) => {
      logger.warn("Bitunix order book failed", { symbol: normalized, error: error.message });
      return { asks: [], bids: [] };
    }),
  ]);

  const funding = unwrapData(fundingPayload, "funding") || {};
  const tickers = unwrapData(tickerPayload, "tickers") || [];
  const ticker = Array.isArray(tickers) ? tickers[0] || {} : tickers;
  const oiSeries = unwrapData(oiPayload, "openInterest") || [];
  const globalSeries = unwrapData(globalLsPayload, "globalLongShort") || [];
  const topAccountSeries = unwrapData(topAccountPayload, "topAccountLongShort") || [];
  const topPositionSeries = unwrapData(topPositionPayload, "topPositionLongShort") || [];
  const liqData = unwrapData(liqPayload, "liquidationMap") || {};

  const oiLatest = latestPoint(oiSeries);
  const oiPrev = previousPoint(oiSeries);
  const oiFirst = oiSeries[0] || null;
  const oiValues = oiSeries.map((row) => toNumber(row.close)).filter((v) => v !== null);

  const globalLatest = latestPoint(globalSeries);
  const globalPrev = previousPoint(globalSeries);
  const globalRatios = globalSeries
    .map((row) => toNumber(row.globalAccountLongShortRatio))
    .filter((v) => v !== null);

  const topAccLatest = latestPoint(topAccountSeries);
  const topAccRatios = topAccountSeries
    .map((row) => toNumber(row.topAccountLongShortRatio))
    .filter((v) => v !== null);

  const topPosLatest = latestPoint(topPositionSeries);
  const topPosRatios = topPositionSeries
    .map((row) => toNumber(row.topPositionLongShortRatio))
    .filter((v) => v !== null);

  const lastPrice =
    toNumber(funding.lastPrice) ?? toNumber(ticker.lastPrice) ?? toNumber(ticker.last);
  const open24h = toNumber(ticker.open);
  const change24hPercent =
    lastPrice !== null && open24h
      ? Number((((lastPrice - open24h) / open24h) * 100).toFixed(2))
      : null;

  const nextFundingMs = toNumber(funding.nextFundingTime);
  const snapshot = {
    source: "bitunix",
    symbol: normalized,
    interval,
    fetchedAt: new Date().toISOString(),
    lastPrice,
    markPrice: toNumber(funding.markPrice),
    indexPrice: toNumber(funding.indexPrice),
    high24h: toNumber(ticker.high),
    low24h: toNumber(ticker.low),
    volume24hUsdt: toNumber(ticker.quoteVol),
    change24hPercent,
    fundingRatePercent: formatFundingPercent(funding.fundingRate),
    fundingIntervalHours: toNumber(funding.fundingInterval),
    nextFundingTime: nextFundingMs
      ? new Date(nextFundingMs).toISOString()
      : null,
    openInterest: {
      latest: toNumber(oiLatest?.close),
      previous: toNumber(oiPrev?.close),
      latestValueUsdt: toNumber(oiLatest?.closeValue),
      changeFromPreviousPercent: pctChange(toNumber(oiPrev?.close), toNumber(oiLatest?.close)),
      change24hPercent: pctChange(toNumber(oiFirst?.close), toNumber(oiLatest?.close)),
      trend: trendFromSeries(oiValues),
      points: oiSeries.slice(-24).map((row) => ({
        time: row.time,
        oi: toNumber(row.close),
        valueUsdt: toNumber(row.closeValue),
      })),
    },
    globalLongShortAccounts: {
      ratio: toNumber(globalLatest?.globalAccountLongShortRatio),
      previousRatio: toNumber(globalPrev?.globalAccountLongShortRatio),
      longPercent: toNumber(globalLatest?.globalAccountLongPercent),
      shortPercent: toNumber(globalLatest?.globalAccountShortPercent),
      trend: trendFromSeries(globalRatios),
    },
    topTraderAccounts: {
      ratio: toNumber(topAccLatest?.topAccountLongShortRatio),
      longPercent: toNumber(topAccLatest?.topAccountLongPercent),
      shortPercent: toNumber(topAccLatest?.topAccountShortPercent),
      trend: trendFromSeries(topAccRatios),
    },
    topTraderPositions: {
      ratio: toNumber(topPosLatest?.topPositionLongShortRatio),
      longPercent: toNumber(topPosLatest?.topPositionLongPercent),
      shortPercent: toNumber(topPosLatest?.topPositionShortPercent),
      trend: trendFromSeries(topPosRatios),
    },
    liquidationMap: summarizeLiquidationMap(liqData.liquidations || [], lastPrice),
    orderBook: summarizeOrderBook(orderBookRaw.asks, orderBookRaw.bids, lastPrice),
    klines: klines.slice(-30),
    lastCandle: klines.length ? klines[klines.length - 1] : null,
    dailyCandle: interval === "1d" && klines.length ? klines[klines.length - 1] : null,
  };

  snapshot.indicators = summarizeIndicators(klines);
  snapshot.indicatorsText = indicatorsToText(snapshot.indicators);
  snapshot.checklistText = buildChecklistText(snapshot);

  logger.info("Bitunix market data fetched", {
    symbol: normalized,
    interval,
    fundingRatePercent: snapshot.fundingRatePercent,
    oiTrend: snapshot.openInterest.trend,
    lsRatio: snapshot.globalLongShortAccounts.ratio,
    klines: klines.length,
  });

  return snapshot;
}

module.exports = {
  fetchBitunixMarketData,
  fetchBitunixKlines,
  fetchBitunixOrderBook,
  buildChecklistText,
};
