const logger = require("../logger");

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

function buildChecklistText(snapshot) {
  const lines = [
    `Symbol: ${snapshot.symbol}`,
    `Timeframe: ${snapshot.interval} (derivatives positioning checklist)`,
    `Last price: ${snapshot.lastPrice ?? "n/a"}`,
    `24h change: ${snapshot.change24hPercent ?? "n/a"}%`,
    `Mark: ${snapshot.markPrice ?? "n/a"} | Index: ${snapshot.indexPrice ?? "n/a"}`,
    `Funding rate: ${snapshot.fundingRatePercent ?? "n/a"}% | Next funding: ${snapshot.nextFundingTime || "n/a"}`,
    `Open Interest (coin): ${snapshot.openInterest.latest ?? "n/a"} (prev ${snapshot.openInterest.previous ?? "n/a"}) trend=${snapshot.openInterest.trend} change24h≈${snapshot.openInterest.change24hPercent ?? "n/a"}%`,
    `Open Interest value USDT: ${snapshot.openInterest.latestValueUsdt ?? "n/a"}`,
    `Long/Short Accounts ratio: ${snapshot.globalLongShortAccounts.ratio ?? "n/a"} (L ${snapshot.globalLongShortAccounts.longPercent ?? "n/a"}% / S ${snapshot.globalLongShortAccounts.shortPercent ?? "n/a"}%) trend=${snapshot.globalLongShortAccounts.trend}`,
    `Top Trader Accounts ratio: ${snapshot.topTraderAccounts.ratio ?? "n/a"} (L ${snapshot.topTraderAccounts.longPercent ?? "n/a"}% / S ${snapshot.topTraderAccounts.shortPercent ?? "n/a"}%) trend=${snapshot.topTraderAccounts.trend}`,
    `Top Trader Positions ratio: ${snapshot.topTraderPositions.ratio ?? "n/a"} (L ${snapshot.topTraderPositions.longPercent ?? "n/a"}% / S ${snapshot.topTraderPositions.shortPercent ?? "n/a"}%) trend=${snapshot.topTraderPositions.trend}`,
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

  return lines.join("\n");
}

async function fetchBitunixMarketData(symbol, options = {}) {
  const normalized = String(symbol || "BTCUSDT").trim().toUpperCase();
  const interval = options.interval || "1h";
  const lower = normalized.toLowerCase();

  const [
    fundingPayload,
    tickerPayload,
    oiPayload,
    globalLsPayload,
    topAccountPayload,
    topPositionPayload,
    liqPayload,
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
      `${API_BASE}/innovation/basic/data/liquidation/map?symbol=${lower}&range=1d`,
    ),
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
  };

  snapshot.checklistText = buildChecklistText(snapshot);

  logger.info("Bitunix market data fetched", {
    symbol: normalized,
    interval,
    fundingRatePercent: snapshot.fundingRatePercent,
    oiTrend: snapshot.openInterest.trend,
    lsRatio: snapshot.globalLongShortAccounts.ratio,
  });

  return snapshot;
}

module.exports = {
  fetchBitunixMarketData,
};
