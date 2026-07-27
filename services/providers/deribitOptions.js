const logger = require("../../logger");

const DERIBIT_BASE = process.env.DERIBIT_BASE_URL || "https://www.deribit.com/api/v2/public";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    throw new Error(`Deribit HTTP ${response.status} for ${url}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(`Deribit error: ${payload.error.message || JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

function parseInstrument(name) {
  // BTC-28AUG26-59000-P
  const match = String(name || "").match(/^BTC-([0-9A-Z]+)-(\d+)-(C|P)$/i);
  if (!match) return null;
  return {
    expiry: match[1],
    strike: Number(match[2]),
    type: match[3].toUpperCase() === "C" ? "call" : "put",
  };
}

function computePutCallRatio(options) {
  let callOi = 0;
  let putOi = 0;
  let callVol = 0;
  let putVol = 0;
  for (const opt of options) {
    const oi = toNumber(opt.open_interest) || 0;
    const vol = toNumber(opt.volume) || 0;
    if (opt.type === "call") {
      callOi += oi;
      callVol += vol;
    } else {
      putOi += oi;
      putVol += vol;
    }
  }
  return {
    oiPutCallRatio: callOi > 0 ? Number((putOi / callOi).toFixed(4)) : null,
    volumePutCallRatio: callVol > 0 ? Number((putVol / callVol).toFixed(4)) : null,
    callOi,
    putOi,
    callVol,
    putVol,
  };
}

function computeMaxPain(options, spot) {
  const strikes = [...new Set(options.map((o) => o.strike).filter(Boolean))].sort((a, b) => a - b);
  if (!strikes.length) return { maxPain: null, nearestSpotStrike: null };

  let bestStrike = strikes[0];
  let bestPain = Number.POSITIVE_INFINITY;

  for (const strike of strikes) {
    let pain = 0;
    for (const opt of options) {
      const oi = toNumber(opt.open_interest) || 0;
      if (!oi) continue;
      if (opt.type === "call") {
        pain += Math.max(0, strike - opt.strike) * oi;
      } else {
        pain += Math.max(0, opt.strike - strike) * oi;
      }
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = strike;
    }
  }

  const nearestSpotStrike =
    spot === null
      ? null
      : strikes.reduce((best, strike) =>
          Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best,
        );

  return {
    maxPain: bestStrike,
    distanceToSpotPercent:
      spot && bestStrike ? Number((((bestStrike - spot) / spot) * 100).toFixed(3)) : null,
    nearestSpotStrike,
  };
}

function computeAtmIvAndSkew(options, spot) {
  if (!spot || !options.length) {
    return { atmIv: null, callIv: null, putIv: null, skew: null, smile: [] };
  }

  const withIv = options
    .map((opt) => ({
      ...opt,
      iv: toNumber(opt.mark_iv) ?? toNumber(opt.impliedVolatility),
      distance: Math.abs(opt.strike - spot),
    }))
    .filter((opt) => opt.iv !== null);

  const atmCall = withIv
    .filter((o) => o.type === "call")
    .sort((a, b) => a.distance - b.distance)[0];
  const atmPut = withIv
    .filter((o) => o.type === "put")
    .sort((a, b) => a.distance - b.distance)[0];

  const callIv = atmCall?.iv ?? null;
  const putIv = atmPut?.iv ?? null;
  const atmIv =
    callIv !== null && putIv !== null
      ? Number(((callIv + putIv) / 2).toFixed(4))
      : callIv ?? putIv;

  // 25-delta proxy via ~5% OTM strikes
  const otmCall = withIv
    .filter((o) => o.type === "call" && o.strike >= spot * 1.04 && o.strike <= spot * 1.08)
    .sort((a, b) => a.distance - b.distance)[0];
  const otmPut = withIv
    .filter((o) => o.type === "put" && o.strike <= spot * 0.96 && o.strike >= spot * 0.92)
    .sort((a, b) => a.distance - b.distance)[0];
  const skew =
    otmPut?.iv !== undefined && otmCall?.iv !== undefined && otmPut && otmCall
      ? Number((otmPut.iv - otmCall.iv).toFixed(4))
      : putIv !== null && callIv !== null
        ? Number((putIv - callIv).toFixed(4))
        : null;

  const smile = withIv
    .filter((o) => o.type === "call")
    .sort((a, b) => a.strike - b.strike)
    .filter((_, idx, arr) => idx % Math.max(1, Math.floor(arr.length / 8)) === 0)
    .slice(0, 8)
    .map((o) => ({ strike: o.strike, iv: o.iv }));

  return { atmIv, callIv, putIv, skew, smile };
}

/**
 * Approximate dealer gamma/delta using OI-weighted moneyness heuristics.
 * Not a full options model; useful directional risk signal.
 */
function estimateDealerExposure(options, spot) {
  if (!spot || !options.length) {
    return {
      dealerGammaProxy: null,
      dealerDeltaProxy: null,
      gammaBias: "unknown",
      note: "insufficient options data",
    };
  }

  let gammaProxy = 0;
  let deltaProxy = 0;

  for (const opt of options) {
    const oi = toNumber(opt.open_interest) || 0;
    if (!oi || !opt.strike) continue;
    const moneyness = opt.strike / spot;
    // Rough gamma peaks near ATM
    const gammaWeight = Math.exp(-Math.pow((moneyness - 1) / 0.08, 2));
    // Assume dealers are short retail-bought options => negative gamma when OI high near ATM
    const signedGamma = -oi * gammaWeight;
    gammaProxy += signedGamma;

    if (opt.type === "call") {
      deltaProxy += -oi * Math.max(0, Math.min(1, 1.5 - moneyness));
    } else {
      deltaProxy += oi * Math.max(0, Math.min(1, moneyness - 0.5));
    }
  }

  return {
    dealerGammaProxy: Number(gammaProxy.toFixed(2)),
    dealerDeltaProxy: Number(deltaProxy.toFixed(2)),
    gammaBias: gammaProxy < -1000 ? "negative_gamma_volatile" : gammaProxy > 1000 ? "positive_gamma_pinning" : "mixed",
    note: "heuristic proxy from OI-weighted moneyness (not full greeks model)",
  };
}

async function fetchDeribitOptionsSnapshot(options = {}) {
  const currency = options.currency || "BTC";

  const [index, bookSummary] = await Promise.all([
    fetchJson(`${DERIBIT_BASE}/get_index_price?index_name=${currency.toLowerCase()}_usd`),
    fetchJson(`${DERIBIT_BASE}/get_book_summary_by_currency?currency=${currency}&kind=option`),
  ]);

  const spot = toNumber(index?.index_price);
  const rawOptions = Array.isArray(bookSummary) ? bookSummary : [];
  const parsed = rawOptions
    .map((row) => {
      const meta = parseInstrument(row.instrument_name);
      if (!meta) return null;
      return {
        instrument: row.instrument_name,
        ...meta,
        volume: toNumber(row.volume),
        open_interest: toNumber(row.open_interest),
        mark_price: toNumber(row.mark_price),
        bid_price: toNumber(row.bid_price),
        ask_price: toNumber(row.ask_price),
        mark_iv: toNumber(row.mark_iv),
        underlying_price: toNumber(row.underlying_price) ?? spot,
      };
    })
    .filter(Boolean);

  // Focus on nearest major expiries by total OI to keep payload useful.
  const byExpiry = new Map();
  for (const opt of parsed) {
    const current = byExpiry.get(opt.expiry) || { expiry: opt.expiry, oi: 0, options: [] };
    current.oi += toNumber(opt.open_interest) || 0;
    current.options.push(opt);
    byExpiry.set(opt.expiry, current);
  }

  const topExpiries = [...byExpiry.values()].sort((a, b) => b.oi - a.oi).slice(0, 3);
  const focusOptions = topExpiries.flatMap((item) => item.options);

  const pcr = computePutCallRatio(focusOptions);
  const maxPain = computeMaxPain(focusOptions, spot);
  const iv = computeAtmIvAndSkew(focusOptions, spot);
  const dealer = estimateDealerExposure(focusOptions, spot);

  const snapshot = {
    source: "deribit_options",
    role: "options_intelligence",
    currency,
    fetchedAt: new Date().toISOString(),
    available: focusOptions.length > 0,
    spot,
    expiriesAnalyzed: topExpiries.map((item) => ({ expiry: item.expiry, oi: item.oi })),
    putCall: pcr,
    maxPain,
    iv,
    dealer,
    optionCount: focusOptions.length,
  };

  snapshot.checklistText = [
    `Source: Deribit Options (${currency})`,
    `Spot/index: ${spot ?? "n/a"}`,
    `Expiries: ${snapshot.expiriesAnalyzed.map((e) => `${e.expiry}(OI ${e.oi})`).join(", ") || "n/a"}`,
    `PCR(OI): ${pcr.oiPutCallRatio ?? "n/a"} | PCR(Vol): ${pcr.volumePutCallRatio ?? "n/a"}`,
    `Max Pain: ${maxPain.maxPain ?? "n/a"} dist=${maxPain.distanceToSpotPercent ?? "n/a"}%`,
    `ATM IV: ${iv.atmIv ?? "n/a"} callIV=${iv.callIv ?? "n/a"} putIV=${iv.putIv ?? "n/a"} skew=${iv.skew ?? "n/a"}`,
    `Dealer gamma proxy: ${dealer.dealerGammaProxy ?? "n/a"} (${dealer.gammaBias})`,
    `Dealer delta proxy: ${dealer.dealerDeltaProxy ?? "n/a"}`,
  ].join("\n");

  logger.info("Deribit options snapshot fetched", {
    currency,
    optionCount: focusOptions.length,
    maxPain: maxPain.maxPain,
    atmIv: iv.atmIv,
    pcr: pcr.oiPutCallRatio,
  });

  return snapshot;
}

module.exports = {
  fetchDeribitOptionsSnapshot,
  computePutCallRatio,
  computeMaxPain,
};
