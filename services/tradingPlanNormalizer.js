const { toAsciiDigits, normalizeLevelText, parsePercent, extractPrices } = require("./numberFormat");

function asArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== null && item !== "").map(String);
  }
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function cleanLevels(values, limit = 4) {
  const out = [];
  const seen = new Set();
  for (const value of asArray(values)) {
    const normalized = normalizeLevelText(value) || toAsciiDigits(String(value).trim());
    if (!normalized || seen.has(normalized) || /نامشخص|n\/a|unknown|-/i.test(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function asDirection(value, bias = "") {
  const text = String(value || "").toUpperCase();
  if (["LONG", "SHORT", "RANGE"].includes(text)) return text;
  if (/bull|صعود|long/i.test(`${value} ${bias}`)) return "LONG";
  if (/bear|نزول|short/i.test(`${value} ${bias}`)) return "SHORT";
  return "RANGE";
}

function asBias(value) {
  const text = String(value || "");
  if (/bull|صعود/i.test(text)) return "Bullish";
  if (/bear|نزول/i.test(text)) return "Bearish";
  return "Neutral";
}

function asValidationStatus(value, fallback = "Partially Confirmed") {
  const text = String(value || "");
  if (/contradict/i.test(text) || /مخالف/.test(text)) return "Contradicted";
  if (/partial/i.test(text) || /بخشی/.test(text)) return "Partially Confirmed";
  if (/confirm/i.test(text) || /تأیید|تایید/.test(text)) return "Confirmed";
  return fallback;
}

function asStatus(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("invalid") || /باطل/.test(String(value || ""))) return "Invalidated";
  if (text.includes("weak") || /ضعیف/.test(String(value || ""))) return "Weakening";
  return "Active";
}

function isBlankLevel(value) {
  const text = String(value || "").trim();
  return !text || /نامشخص|unknown|n\/a|^-$/i.test(text);
}

function firstPriceText(value) {
  const prices = extractPrices(value);
  return prices.length ? String(prices[0]) : "";
}

function buildLevelsFromSupportsResistances(supports, resistances, currentPrice) {
  const supportNums = supports.map((item) => extractPrices(item)[0]).filter(Number.isFinite);
  const resistanceNums = resistances.map((item) => extractPrices(item)[0]).filter(Number.isFinite);
  const price = extractPrices(currentPrice)[0];
  if (!supportNums.length || !resistanceNums.length) return null;

  const support = Math.max(...supportNums.filter((v) => !price || v <= price), supportNums[0]);
  const lower = Math.min(...supportNums);
  const resistance = Math.min(...resistanceNums.filter((v) => !price || v >= price), resistanceNums[0]);
  const upper = Math.max(...resistanceNums);
  if (!Number.isFinite(support) || !Number.isFinite(resistance)) return null;

  return {
    entry: `${Math.round(Math.min(support, lower))}-${Math.round(Math.max(support, lower))}`,
    stop_loss: String(Math.round(lower * 0.997)),
    tp1: String(Math.round((support + resistance) / 2)),
    tp2: String(Math.round(resistance)),
    tp3: String(Math.round(upper)),
    risk_reward: "n/a",
    invalidation: String(Math.round(lower * 0.997)),
  };
}

function pickLevel(...candidates) {
  for (const value of candidates) {
    if (isBlankLevel(value)) continue;
    const normalized = normalizeLevelText(value) || toAsciiDigits(String(value)).trim();
    if (!isBlankLevel(normalized)) return normalized;
  }
  return "";
}

function chartGateLabel(setup = {}) {
  if (setup.trade_allowed && (setup.direction === "LONG" || setup.direction === "SHORT")) {
    return `${setup.direction} confirmed`;
  }
  if (setup.levels_ready || setup.entry) {
    return "RANGE levels mapped (no directional trade)";
  }
  return "levels unavailable";
}

/**
 * Single source of truth for daily stance.
 * LONG/SHORT only when chart_setup.trade_allowed=true.
 * Otherwise always RANGE (bias may still lean Bullish/Bearish from engine).
 */
function resolvePlanStance(engine = {}, raw = {}) {
  const chartSetup = engine.chart_setup || {};
  const engineBias = asBias(engine.bias || raw.bias || "Neutral");

  if (
    chartSetup.trade_allowed &&
    (chartSetup.direction === "LONG" || chartSetup.direction === "SHORT")
  ) {
    return {
      direction: chartSetup.direction,
      bias: chartSetup.direction === "LONG" ? "Bullish" : "Bearish",
      trade_allowed: true,
      confidence: parsePercent(engine.confidence, parsePercent(raw.confidence, 50)),
    };
  }

  return {
    direction: "RANGE",
    bias: engineBias,
    trade_allowed: false,
    // Do not let the model inflate confidence into a fake directional trade.
    confidence: parsePercent(engine.confidence, parsePercent(raw.confidence, 50)),
  };
}

function buildTechnicalFallback(engine = {}, rawTech = {}) {
  const chart = engine.chart_snapshot || {};
  const setup = engine.chart_setup || {};
  const pattern = chart.top_pattern;
  const mtf = chart.multi_timeframe || {};
  return {
    mtf_summary:
      rawTech.mtf_summary ||
      (Object.keys(mtf).length
        ? `1D=${mtf["1d"]} | 4H=${mtf["4h"]} | 1H=${mtf["1h"]} | 15M=${mtf["15m"]} | 5M=${mtf["5m"]}`
        : ""),
    market_structure: rawTech.market_structure || chart.htf?.structure?.structure || "",
    major_support:
      rawTech.major_support ||
      (chart.htf?.levels?.majorSupport || []).join(", ") ||
      "",
    major_resistance:
      rawTech.major_resistance ||
      (chart.htf?.levels?.majorResistance || []).join(", ") ||
      "",
    indicators_status:
      rawTech.indicators_status ||
      (chart.htf?.indicators
        ? `Trend=${chart.htf.indicators.trend} EMA20=${chart.htf.indicators.ema20} RSI=${chart.ltf?.indicators?.rsi} MACD=${chart.ltf?.indicators?.macd?.bias}`
        : ""),
    volume_status: rawTech.volume_status || chart.ltf?.volume?.confirmation || "",
    pattern:
      rawTech.pattern ||
      (pattern
        ? `${pattern.name} ${pattern.timeframe} (${pattern.confidence}%)`
        : "none"),
    fibonacci:
      rawTech.fibonacci ||
      (chart.htf?.fibonacci?.levels
        ? `0.382=${chart.htf.fibonacci.levels["0.382"]} | 0.5=${chart.htf.fibonacci.levels["0.5"]} | 0.618=${chart.htf.fibonacci.levels["0.618"]}`
        : ""),
    liquidity_notes:
      rawTech.liquidity_notes ||
      (chart.liquidity?.notes || []).join(" | ") ||
      chart.liquidity?.state ||
      "",
    chart_setup_status: chartGateLabel(setup),
  };
}

function normalizeTradingPlan(symbol, raw, engine = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const chartSetup = engine.chart_setup || {};
  const chart = engine.chart_snapshot || {};
  const stance = resolvePlanStance(engine, data);
  const bias = stance.bias;
  const direction = stance.direction;
  const technical = buildTechnicalFallback(engine, data.technical_analysis || {});

  const supports = cleanLevels(
    [
      ...asArray(data.supports),
      ...(chart.htf?.levels?.majorSupport || []),
      ...String(technical.major_support || "")
        .split(",")
        .map((item) => item.trim()),
    ],
    4,
  );
  const resistances = cleanLevels(
    [
      ...asArray(data.resistances),
      ...(chart.htf?.levels?.majorResistance || []),
      ...String(technical.major_resistance || "")
        .split(",")
        .map((item) => item.trim()),
    ],
    4,
  );

  const currentPrice =
    normalizeLevelText(data.current_price) ||
    toAsciiDigits(data.current_price || "").trim() ||
    (chart.ltf?.price != null ? String(chart.ltf.price) : "") ||
    (chart.htf?.price != null ? String(chart.htf.price) : "");

  // Always prefer concrete chart-mapped levels when present (even on RANGE days).
  const fallbackFromSr = buildLevelsFromSupportsResistances(supports, resistances, currentPrice);

  // Prefer any concrete chart-mapped field even when trade_allowed=false.
  const entry =
    pickLevel(chartSetup.entry, data.entry, fallbackFromSr?.entry) || "نامشخص";
  const stopLoss =
    pickLevel(chartSetup.stop_loss, data.stop_loss, fallbackFromSr?.stop_loss) || "نامشخص";
  const tp1 = pickLevel(chartSetup.tp1, data.tp1, fallbackFromSr?.tp1);
  const tp2 = pickLevel(chartSetup.tp2, data.tp2, fallbackFromSr?.tp2);
  const tp3 = pickLevel(chartSetup.tp3, data.tp3, fallbackFromSr?.tp3);
  const riskReward =
    pickLevel(chartSetup.risk_reward, data.risk_reward, data.rr, fallbackFromSr?.risk_reward) ||
    "n/a";
  const invalidation = pickLevel(
    chartSetup.invalidation,
    data.invalidation_level,
    fallbackFromSr?.invalidation,
    stopLoss,
  );

  return {
    symbol,
    pair_label: "BTC / USDT",
    bias,
    direction,
    trade_allowed: stance.trade_allowed,
    confidence: stance.confidence,
    market_score: parsePercent(data.market_score, engine.market_score || stance.confidence || 50),
    market_regime: data.market_regime || engine.market_regime || "Range",
    risk_level: ["Low", "Medium", "High"].includes(data.risk_level)
      ? data.risk_level
      : engine.risk_level || "Medium",
    current_price: currentPrice,
    coinex_summary: toAsciiDigits(data.coinex_summary || "").trim(),
    coinex_validation_status: asValidationStatus(
      data.coinex_validation_status,
      engine.validation?.status || "Partially Confirmed",
    ),
    futures_analysis: data.futures_analysis || {},
    options_analysis: data.options_analysis || {},
    technical_analysis: {
      ...technical,
      chart_setup_status: chartGateLabel({
        ...chartSetup,
        trade_allowed: stance.trade_allowed,
        direction,
        entry,
        levels_ready: Boolean(
          chartSetup.levels_ready || (!isBlankLevel(entry) && !isBlankLevel(stopLoss)),
        ),
      }),
    },
    execution_notes: asArray(data.execution_notes).map((item) => toAsciiDigits(item).trim()).slice(0, 5),
    main_scenario: toAsciiDigits(data.main_scenario || data.reason || "").trim(),
    entry,
    stop_loss: stopLoss,
    tp1,
    tp2,
    tp3,
    risk_reward: riskReward,
    supports: supports.length ? supports : cleanLevels([firstPriceText(entry)], 2),
    resistances: resistances.length ? resistances : cleanLevels([tp2, tp3, tp1], 3),
    invalidation_level: invalidation,
    reversal_trigger: toAsciiDigits(data.reversal_trigger || "").trim(),
    alternative_scenario: toAsciiDigits(data.alternative_scenario || "").trim(),
    risk_warnings: asArray(data.risk_warnings).map((item) => toAsciiDigits(item).trim()).slice(0, 6),
    reason: toAsciiDigits(data.reason || "").trim(),
    summary: toAsciiDigits(data.summary || data.main_scenario || "").trim(),
    status: "Active",
  };
}

function normalizePlanEvaluation(lockedPlan, raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const status = asStatus(data.setup_status || data.status);
  return {
    setup_status: status,
    confidence: parsePercent(data.confidence, lockedPlan.confidence || 50),
    previous_confidence: parsePercent(data.previous_confidence, lockedPlan.confidence || 50),
    market_score: parsePercent(data.market_score, lockedPlan.market_score || 50),
    bias: asBias(data.bias || lockedPlan.bias),
    changes: asArray(data.changes).map((item) => toAsciiDigits(item).trim()).slice(0, 8),
    futures_status: toAsciiDigits(data.futures_status || "").trim(),
    options_status: toAsciiDigits(data.options_status || "").trim(),
    execution_status: toAsciiDigits(data.execution_status || "").trim(),
    rationale: toAsciiDigits(data.rationale || "").trim(),
    result: toAsciiDigits(data.result || "").trim(),
    entry: lockedPlan.entry,
    stop_loss: lockedPlan.stop_loss,
    tp1: lockedPlan.tp1,
    tp2: lockedPlan.tp2,
    tp3: lockedPlan.tp3,
    supports: lockedPlan.supports || [],
    resistances: lockedPlan.resistances || [],
    invalidation_hit: Boolean(data.invalidation_hit) || status === "Invalidated",
    summary: toAsciiDigits(data.summary || data.result || "").trim(),
  };
}

module.exports = {
  normalizeTradingPlan,
  normalizePlanEvaluation,
  resolvePlanStance,
};
