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

function computeRr(entry, stopLoss, tp1) {
  const entryPrices = extractPrices(entry);
  if (!entryPrices.length) return null;
  const entryMid =
    entryPrices.length >= 2 ? (entryPrices[0] + entryPrices[1]) / 2 : entryPrices[0];
  const sl = extractPrices(stopLoss)[0];
  const tp = extractPrices(tp1)[0];
  if (!Number.isFinite(sl) || !Number.isFinite(tp) || !Number.isFinite(entryMid)) return null;
  const risk = Math.abs(entryMid - sl);
  const reward = Math.abs(tp - entryMid);
  if (risk <= 0) return null;
  return `1:${round1(reward / risk)}`;
}

/**
 * Hard guarantee: plan always has concrete Entry/TP/SL before Telegram/chart.
 * Sources (in order): existing plan → chart_setup → chart HTF S/R → tech text → price band.
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

  const supports = asPriceList(
    next.supports,
    tech.major_support,
    htf.levels?.majorSupport,
    chartSetup.entry,
  ).sort((a, b) => b - a);

  const resistances = asPriceList(
    next.resistances,
    tech.major_resistance,
    htf.levels?.majorResistance,
    chartSetup.tp1,
    chartSetup.tp2,
    chartSetup.tp3,
  ).sort((a, b) => a - b);

  // 1) Prefer engine chart_setup whenever present.
  if (!isBlankLevel(chartSetup.entry)) next.entry = String(chartSetup.entry);
  if (!isBlankLevel(chartSetup.stop_loss)) next.stop_loss = String(chartSetup.stop_loss);
  if (!isBlankLevel(chartSetup.tp1)) next.tp1 = String(chartSetup.tp1);
  if (!isBlankLevel(chartSetup.tp2)) next.tp2 = String(chartSetup.tp2);
  if (!isBlankLevel(chartSetup.tp3)) next.tp3 = String(chartSetup.tp3);
  if (!isBlankLevel(chartSetup.risk_reward)) next.risk_reward = String(chartSetup.risk_reward);
  if (!isBlankLevel(chartSetup.invalidation)) {
    next.invalidation_level = String(chartSetup.invalidation);
  }

  // 2) Build from S/R if still blank.
  if ((isBlankLevel(next.entry) || isBlankLevel(next.stop_loss) || isBlankLevel(next.tp1)) &&
      supports.length &&
      resistances.length) {
    const support = price ? supports.find((v) => v <= price) || supports[0] : supports[0];
    const lower = Math.min(...supports);
    const resistance = price ? resistances.find((v) => v >= price) || resistances[0] : resistances[0];
    const upper = Math.max(...resistances);
    if (isBlankLevel(next.entry)) {
      next.entry = `${round1(Math.min(support, lower))}-${round1(Math.max(support, lower))}`;
    }
    if (isBlankLevel(next.stop_loss)) next.stop_loss = String(round1(lower * 0.997));
    if (isBlankLevel(next.tp1)) next.tp1 = String(round1((support + resistance) / 2));
    if (isBlankLevel(next.tp2)) next.tp2 = String(round1(resistance));
    if (isBlankLevel(next.tp3)) next.tp3 = String(round1(upper));
    if (isBlankLevel(next.invalidation_level)) next.invalidation_level = next.stop_loss;
  }

  // 3) Last resort from current price band so chart/caption never show نامشخص.
  if (price && (isBlankLevel(next.entry) || isBlankLevel(next.stop_loss) || isBlankLevel(next.tp1))) {
    const low = round1(price * 0.992);
    const midLow = round1(price * 0.996);
    const mid = round1(price * 1.004);
    const high = round1(price * 1.01);
    const ext = round1(price * 1.018);
    if (isBlankLevel(next.entry)) next.entry = `${low}-${midLow}`;
    if (isBlankLevel(next.stop_loss)) next.stop_loss = String(round1(low * 0.997));
    if (isBlankLevel(next.tp1)) next.tp1 = String(mid);
    if (isBlankLevel(next.tp2)) next.tp2 = String(high);
    if (isBlankLevel(next.tp3)) next.tp3 = String(ext);
    if (isBlankLevel(next.invalidation_level)) next.invalidation_level = next.stop_loss;
  }

  if (isBlankLevel(next.risk_reward) || next.risk_reward === "n/a") {
    next.risk_reward = computeRr(next.entry, next.stop_loss, next.tp1) || next.risk_reward || "n/a";
  }

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

  // Direction: LONG/SHORT only when engine trade_allowed; otherwise keep RANGE.
  if (chartSetup.trade_allowed && (chartSetup.direction === "LONG" || chartSetup.direction === "SHORT")) {
    next.direction = chartSetup.direction;
    next.bias = chartSetup.direction === "LONG" ? "Bullish" : "Bearish";
    next.trade_allowed = true;
  } else {
    next.direction = "RANGE";
    next.trade_allowed = false;
    if (!next.bias) next.bias = "Neutral";
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
};
