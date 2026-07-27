const { fetchBitunixMarketData } = require("../bitunixData");

/**
 * Bitunix is the execution venue, not the primary market-truth source.
 * We keep a compact snapshot for fill quality / venue divergence checks.
 */
async function fetchBitunixExecutionSnapshot(symbol = "BTCUSDT", options = {}) {
  const interval = options.interval || "1h";
  const raw = await fetchBitunixMarketData(symbol, { interval, ...options });

  return {
    source: "bitunix_execution",
    role: "execution_venue",
    symbol: raw.symbol,
    interval: raw.interval,
    fetchedAt: raw.fetchedAt,
    available: true,
    lastPrice: raw.lastPrice,
    markPrice: raw.markPrice,
    indexPrice: raw.indexPrice,
    fundingRatePercent: raw.fundingRatePercent,
    openInterest: {
      latest: raw.openInterest?.latest ?? null,
      valueUsdt: raw.openInterest?.latestValueUsdt ?? null,
      trend: raw.openInterest?.trend ?? null,
    },
    orderBook: raw.orderBook,
    globalLongShortAccounts: raw.globalLongShortAccounts,
    checklistText: [
      `Source: Bitunix Execution (${raw.symbol})`,
      `Price: ${raw.lastPrice ?? "n/a"} mark=${raw.markPrice ?? "n/a"}`,
      `Funding: ${raw.fundingRatePercent ?? "n/a"}%`,
      `OI: ${raw.openInterest?.latest ?? "n/a"} valueUSDT=${raw.openInterest?.latestValueUsdt ?? "n/a"} trend=${raw.openInterest?.trend ?? "n/a"}`,
      `OrderBook imbalance: ${raw.orderBook?.imbalancePercent ?? "n/a"}% (${raw.orderBook?.bias || "n/a"})`,
      `Venue L/S accounts: ${raw.globalLongShortAccounts?.ratio ?? "n/a"}`,
    ].join("\n"),
    raw,
  };
}

function compareExecutionVenue(binance, bitunix) {
  if (!binance?.available || !bitunix?.available) {
    return {
      available: false,
      notes: ["مقایسه اجرا ممکن نیست؛ یکی از منابع در دسترس نیست"],
      fundingDivergencePercent: null,
      priceDivergencePercent: null,
    };
  }

  const bFunding = Number(binance.fundingRatePercent);
  const uFunding = Number(bitunix.fundingRatePercent);
  const bPrice = Number(binance.lastPrice);
  const uPrice = Number(bitunix.lastPrice);

  const fundingDivergencePercent =
    Number.isFinite(bFunding) && Number.isFinite(uFunding)
      ? Number((uFunding - bFunding).toFixed(4))
      : null;
  const priceDivergencePercent =
    Number.isFinite(bPrice) && Number.isFinite(uPrice) && bPrice !== 0
      ? Number((((uPrice - bPrice) / bPrice) * 100).toFixed(4))
      : null;

  const notes = [];
  if (fundingDivergencePercent !== null) {
    if (fundingDivergencePercent > 0.01) {
      notes.push("Funding بیتونیکس بالاتر از بایننس است → احتمال فشار لانگ بیشتر در محل اجرا");
    } else if (fundingDivergencePercent < -0.01) {
      notes.push("Funding بیتونیکس پایین‌تر از بایننس است → احتمال فشار شورت بیشتر در محل اجرا");
    } else {
      notes.push("Funding بیتونیکس و بایننس نزدیک هم هستند");
    }
  }
  if (priceDivergencePercent !== null && Math.abs(priceDivergencePercent) >= 0.05) {
    notes.push(`اختلاف قیمت اجرا با مرجع بایننس حدود ${priceDivergencePercent}% است`);
  }

  return {
    available: true,
    fundingDivergencePercent,
    priceDivergencePercent,
    notes,
  };
}

module.exports = {
  fetchBitunixExecutionSnapshot,
  compareExecutionVenue,
};
