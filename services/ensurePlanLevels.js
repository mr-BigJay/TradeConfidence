const { extractPrices, normalizeLevelText, toAsciiDigits } = require("./numberFormat");

function isBlankLevel(value) {
  const text = String(value ?? "").trim();
  return !text || /نامشخص|unknown|n\/a|^-$/i.test(text);
}

function round1(value) {
  return Number(Number(value).toFixed(1));
}

function asPriceList(...sources) {
  const out = [];
  for (const source of sources) {
    if (source === null || source === undefined || source === "") continue;
    if (Array.isArray(source)) {
      for (const item of source) out.push(...extractPrices(item));
      continue;
    }
    out.push(...extractPrices(source));
  }
  return [...new Set(out.filter((n) => Number.isFinite(n) && n > 0))];
}

function entryMid(entry) {
  const prices = extractPrices(entry);
  if (!prices.length) return null;
  return prices.length >= 2 ? (prices[0] + prices[1]) / 2 : prices[0];
}

function computeRrNumber(entry, stopLoss, tp1) {
  const mid = entryMid(entry);
  const sl = extractPrices(stopLoss)[0];
  const tp = extractPrices(tp1)[0];
  if (!Number.isFinite(mid) || !Number.isFinite(sl) || !Number.isFinite(tp)) return null;
  const risk = Math.abs(mid - sl);
  const reward = Math.abs(tp - mid);
  if (risk <= 0) return null;
  return reward / risk;
}

function computeRr(entry, stopLoss, tp1) {
  const ratio = computeRrNumber(entry, stopLoss, tp1);
  return ratio === null ? null : `1:${round1(ratio)}`;
}

function entryWidthPct(entry, price) {
  const prices = extractPrices(entry);
  if (prices.length < 2) return 0;
  const width = Math.abs(prices[0] - prices[1]);
  const base = price || Math.max(...prices);
  return base > 0 ? (width / base) * 100 : 0;
}

/**
 * Validate LONG/SHORT/RANGE geometry.
 * LONG: SL < entry < TP1 <= TP2 <= TP3
 * SHORT: TP3 <= TP2 <= TP1 < entry < SL
 */
function isValidGeometry({ direction, bias, entry, stopLoss, tp1, tp2, tp3, price }) {
  const mid = entryMid(entry);
  const sl = extractPrices(stopLoss)[0];
  const t1 = extractPrices(tp1)[0];
  const t2 = extractPrices(tp2)[0] || t1;
  const t3 = extractPrices(tp3)[0] || t2;
  if (![mid, sl, t1].every(Number.isFinite)) return false;
  if (entryWidthPct(entry, price || mid) > 1.2) return false;

  const rr = computeRrNumber(entry, stopLoss, tp1);
  if (rr === null || rr < 1) return false;

  const shortBias =
    direction === "SHORT" || (direction === "RANGE" && /bear/i.test(String(bias || "")));
  if (shortBias) {
    return t3 <= t2 && t2 <= t1 && t1 < mid && mid < sl;
  }
  // LONG or Neutral RANGE → long-style monitoring levels
  return sl < mid && mid < t1 && t1 <= t2 && t2 <= t3;
}

/**
 * Build actionable levels from S/R.
 * Bearish/SHORT → sell resistance zone
 * Bullish/LONG/Neutral → buy support zone
 */
function buildActionableLevels({
  bias = "Neutral",
  direction = "RANGE",
  price = null,
  supports = [],
  resistances = [],
}) {
  const supportList = asPriceList(supports).sort((a, b) => b - a);
  const resistanceList = asPriceList(resistances).sort((a, b) => a - b);
  const px = Number.isFinite(price) ? price : null;

  let support = supportList.find((v) => !px || v <= px) || supportList[0];
  let resistance = resistanceList.find((v) => !px || v >= px) || resistanceList[0];
  let lower = supportList.length ? Math.min(...supportList) : null;
  let upper = resistanceList.length ? Math.max(...resistanceList) : null;

  // Synthesize anchors from price if S/R sparse.
  if (!Number.isFinite(support) && px) support = round1(px * 0.992);
  if (!Number.isFinite(resistance) && px) resistance = round1(px * 1.008);
  if (!Number.isFinite(lower) && Number.isFinite(support)) lower = round1(support * 0.994);
  if (!Number.isFinite(upper) && Number.isFinite(resistance)) upper = round1(resistance * 1.012);
  if (!Number.isFinite(support) || !Number.isFinite(resistance)) return null;

  // Keep a usable range width between support and resistance.
  if (resistance <= support) {
    if (px) {
      support = round1(px * 0.992);
      resistance = round1(px * 1.008);
      lower = round1(support * 0.994);
      upper = round1(resistance * 1.012);
    } else {
      return null;
    }
  }

  const shortBias =
    direction === "SHORT" || (direction !== "LONG" && /bear/i.test(String(bias || "")));

  if (shortBias) {
    // Sell the range top / resistance reaction.
    let high = round1(resistance);
    let low = round1(high * 0.9965);
    const mid = (low + high) / 2;
    let stopLoss = round1(Math.max(upper || high, high) * 1.003);
    let t1 = round1(Math.min((support + resistance) / 2, mid * 0.99));
    let t2 = round1(Math.min(support, t1 * 0.992));
    let t3 = round1(Math.min(lower || support * 0.992, t2 * 0.992));

    // Enforce RR >= 1.2 by tightening SL if needed.
    let risk = Math.abs(stopLoss - mid);
    let reward = Math.abs(mid - t1);
  if (risk > 0 && reward / risk < 1.2) {
    stopLoss = round1(mid + reward / 1.25);
    if (stopLoss <= high) stopLoss = round1(high * 1.002);
  }
  risk = Math.abs(stopLoss - mid);
  reward = Math.abs(mid - t1);
  if (risk > 0 && reward / risk < 1.2) {
    t1 = round1(mid - risk * 1.25);
    t2 = round1(Math.min(t2, t1 * 0.992));
    t3 = round1(Math.min(t3, t2 * 0.992));
  }

    const entry = `${Math.min(low, high)}-${Math.max(low, high)}`;
    return {
      entry,
      stop_loss: String(stopLoss),
      tp1: String(t1),
      tp2: String(t2),
      tp3: String(t3),
      invalidation: String(stopLoss),
      risk_reward: computeRr(entry, stopLoss, t1) || "n/a",
      side: "SHORT",
    };
  }

  // Buy the range bottom / support reaction (Bullish or Neutral).
  let low = round1(support);
  let high = round1(low * 1.0035);
  const mid = (low + high) / 2;
  let stopLoss = round1(Math.min(lower || low, low) * 0.997);
  let t1 = round1(Math.max((support + resistance) / 2, mid * 1.008));
  let t2 = round1(Math.max(resistance, t1 * 1.008));
  let t3 = round1(Math.max(upper || resistance * 1.01, t2 * 1.008));

  let risk = Math.abs(mid - stopLoss);
  let reward = Math.abs(t1 - mid);
  if (risk > 0 && reward / risk < 1.2) {
    stopLoss = round1(mid - reward / 1.25);
    if (stopLoss >= low) stopLoss = round1(low * 0.998);
  }
  risk = Math.abs(mid - stopLoss);
  reward = Math.abs(t1 - mid);
  if (risk > 0 && reward / risk < 1.2) {
    t1 = round1(mid + risk * 1.25);
    t2 = round1(Math.max(t2, t1 * 1.008));
    t3 = round1(Math.max(t3, t2 * 1.008));
  }

  const entry = `${Math.min(low, high)}-${Math.max(low, high)}`;
  return {
    entry,
    stop_loss: String(stopLoss),
    tp1: String(t1),
    tp2: String(t2),
    tp3: String(t3),
    invalidation: String(stopLoss),
    risk_reward: computeRr(entry, stopLoss, t1) || "n/a",
    side: "LONG",
  };
}

/**
 * Hard guarantee: plan always has concrete + geometrically valid Entry/TP/SL.
 */
function ensureTradingPlanLevels(plan, engineScore = {}, marketBundle = {}) {
  const next = { ...(plan || {}) };
  const chartSetup = engineScore.chart_setup || {};
  const snap = engineScore.chart_snapshot || {};
  const chart = marketBundle.chart || {};
  const htf = snap.htf || chart.htf || {};
  const tech = next.technical_analysis || {};
  const price =
    extractPrices(next.current_price)[0] ||
    extractPrices(marketBundle.futures?.price)[0] ||
    extractPrices(htf.price)[0] ||
    extractPrices(chart.ltf?.price)[0] ||
    null;

  // Direction lock first (needed for level geometry).
  if (chartSetup.trade_allowed && (chartSetup.direction === "LONG" || chartSetup.direction === "SHORT")) {
    next.direction = chartSetup.direction;
    next.bias = chartSetup.direction === "LONG" ? "Bullish" : "Bearish";
    next.trade_allowed = true;
  } else {
    next.direction = "RANGE";
    next.trade_allowed = false;
    next.bias = next.bias || engineScore.bias || "Neutral";
  }

  const supports = asPriceList(
    next.supports,
    tech.major_support,
    htf.levels?.majorSupport,
    chartSetup.entry,
    chartSetup.stop_loss,
  ).sort((a, b) => b - a);

  const resistances = asPriceList(
    next.resistances,
    tech.major_resistance,
    htf.levels?.majorResistance,
    chartSetup.tp1,
    chartSetup.tp2,
    chartSetup.tp3,
  ).sort((a, b) => a - b);

  // Seed from chart_setup first.
  if (!isBlankLevel(chartSetup.entry)) next.entry = String(chartSetup.entry);
  if (!isBlankLevel(chartSetup.stop_loss)) next.stop_loss = String(chartSetup.stop_loss);
  if (!isBlankLevel(chartSetup.tp1)) next.tp1 = String(chartSetup.tp1);
  if (!isBlankLevel(chartSetup.tp2)) next.tp2 = String(chartSetup.tp2);
  if (!isBlankLevel(chartSetup.tp3)) next.tp3 = String(chartSetup.tp3);
  if (!isBlankLevel(chartSetup.invalidation)) next.invalidation_level = String(chartSetup.invalidation);

  const needsRebuild =
    isBlankLevel(next.entry) ||
    isBlankLevel(next.stop_loss) ||
    isBlankLevel(next.tp1) ||
    !isValidGeometry({
      direction: next.direction,
      bias: next.bias,
      entry: next.entry,
      stopLoss: next.stop_loss,
      tp1: next.tp1,
      tp2: next.tp2,
      tp3: next.tp3,
      price,
    });

  if (needsRebuild) {
    const rebuilt = buildActionableLevels({
      bias: next.bias,
      direction: next.direction,
      price,
      supports: supports.length ? supports : [price ? price * 0.99 : null].filter(Boolean),
      resistances: resistances.length ? resistances : [price ? price * 1.01 : null].filter(Boolean),
    });
    if (rebuilt) {
      next.entry = rebuilt.entry;
      next.stop_loss = rebuilt.stop_loss;
      next.tp1 = rebuilt.tp1;
      next.tp2 = rebuilt.tp2;
      next.tp3 = rebuilt.tp3;
      next.invalidation_level = rebuilt.invalidation;
      next.risk_reward = rebuilt.risk_reward;
    }
  }

  next.risk_reward =
    computeRr(next.entry, next.stop_loss, next.tp1) || next.risk_reward || "n/a";

  if (!next.supports?.length && supports.length) {
    next.supports = supports.slice(0, 4).map(String);
  }
  if (!next.resistances?.length && resistances.length) {
    next.resistances = resistances.slice(0, 4).map(String);
  }

  if (next.current_price) {
    next.current_price = normalizeLevelText(next.current_price) || toAsciiDigits(next.current_price);
  } else if (price) {
    next.current_price = String(round1(price));
  }

  if (next.technical_analysis && typeof next.technical_analysis === "object") {
    const levelsOk = !isBlankLevel(next.entry) && !isBlankLevel(next.stop_loss);
    next.technical_analysis = {
      ...next.technical_analysis,
      chart_setup_status: next.trade_allowed
        ? `${next.direction} confirmed`
        : levelsOk
          ? "RANGE levels mapped (no directional trade)"
          : next.technical_analysis.chart_setup_status || "levels mapped",
    };
  }

  return next;
}

module.exports = {
  ensureTradingPlanLevels,
  isBlankLevel,
  buildActionableLevels,
  isValidGeometry,
  computeRr,
  computeRrNumber,
};
