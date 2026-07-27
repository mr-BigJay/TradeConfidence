const { toAsciiDigits, normalizeLevelText, parsePercent } = require("./numberFormat");

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
    if (!normalized || seen.has(normalized)) continue;
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

function normalizeTradingPlan(symbol, raw, engine = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const bias = asBias(data.bias || engine.bias || "Neutral");
  return {
    symbol,
    pair_label: "BTC / USDT",
    bias,
    direction: asDirection(data.direction, bias),
    confidence: parsePercent(data.confidence, engine.confidence || 50),
    market_score: parsePercent(data.market_score, engine.market_score || engine.confidence || 50),
    market_regime: data.market_regime || engine.market_regime || "Range",
    risk_level: ["Low", "Medium", "High"].includes(data.risk_level)
      ? data.risk_level
      : engine.risk_level || "Medium",
    current_price: normalizeLevelText(data.current_price) || toAsciiDigits(data.current_price || ""),
    coinex_summary: toAsciiDigits(data.coinex_summary || "").trim(),
    coinex_validation_status: asValidationStatus(
      data.coinex_validation_status,
      engine.validation?.status || "Partially Confirmed",
    ),
    futures_analysis: data.futures_analysis || {},
    options_analysis: data.options_analysis || {},
    execution_notes: asArray(data.execution_notes).map((item) => toAsciiDigits(item).trim()).slice(0, 5),
    main_scenario: toAsciiDigits(data.main_scenario || data.reason || "").trim(),
    entry: normalizeLevelText(data.entry) || toAsciiDigits(data.entry || "").trim() || "نامشخص",
    stop_loss:
      normalizeLevelText(data.stop_loss) || toAsciiDigits(data.stop_loss || "").trim() || "نامشخص",
    tp1: normalizeLevelText(data.tp1) || toAsciiDigits(data.tp1 || "").trim() || "",
    tp2: normalizeLevelText(data.tp2) || toAsciiDigits(data.tp2 || "").trim() || "",
    tp3: normalizeLevelText(data.tp3) || toAsciiDigits(data.tp3 || "").trim() || "",
    risk_reward: toAsciiDigits(data.risk_reward || data.rr || "").trim() || "n/a",
    supports: cleanLevels(data.supports, 4),
    resistances: cleanLevels(data.resistances, 4),
    invalidation_level:
      normalizeLevelText(data.invalidation_level) || toAsciiDigits(data.invalidation_level || "").trim(),
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
};
