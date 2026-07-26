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
  if (/صعود|bull|long/i.test(bias)) return "LONG";
  if (/نزول|bear|short/i.test(bias)) return "SHORT";
  return "RANGE";
}

function asStatus(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("invalid")) return "Invalidated";
  if (text.includes("weak")) return "Weakening";
  if (text.includes("active") || text.includes("valid")) return "Active";
  if (/باطل|از بین/.test(String(value || ""))) return "Invalidated";
  if (/ضعیف/.test(String(value || ""))) return "Weakening";
  return "Active";
}

function normalizeDailySetup(symbol, raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const bias = toAsciiDigits(data.bias || "خنثی").trim() || "خنثی";
  return {
    symbol,
    pair_label: data.pair_label || "BTC / USDT",
    bias,
    direction: asDirection(data.direction, bias),
    confidence: parsePercent(data.confidence, 50),
    market_score: parsePercent(data.market_score, 50),
    risk_level: ["Low", "Medium", "High"].includes(data.risk_level) ? data.risk_level : "Medium",
    risk_notes: toAsciiDigits(data.risk_notes || "").trim(),
    main_scenario: toAsciiDigits(data.main_scenario || data.summary || "").trim(),
    entry: normalizeLevelText(data.entry) || toAsciiDigits(data.entry || "").trim() || "نامشخص",
    stop_loss:
      normalizeLevelText(data.stop_loss) || toAsciiDigits(data.stop_loss || "").trim() || "نامشخص",
    tp1: normalizeLevelText(data.tp1) || toAsciiDigits(data.tp1 || "").trim() || "",
    tp2: normalizeLevelText(data.tp2) || toAsciiDigits(data.tp2 || "").trim() || "",
    tp3: normalizeLevelText(data.tp3) || toAsciiDigits(data.tp3 || "").trim() || "",
    supports: cleanLevels(data.supports, 4),
    resistances: cleanLevels(data.resistances, 4),
    invalidation: toAsciiDigits(data.invalidation || "").trim(),
    watchpoints: asArray(data.watchpoints).map((item) => toAsciiDigits(item).trim()).slice(0, 5),
    summary: toAsciiDigits(data.summary || data.main_scenario || "").trim(),
    status: "Active",
  };
}

function normalizeSetupEvaluation(lockedSetup, raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const status = asStatus(data.setup_status || data.status);
  return {
    setup_status: status,
    confidence: parsePercent(data.confidence, lockedSetup.confidence || 50),
    previous_confidence: parsePercent(
      data.previous_confidence,
      lockedSetup.confidence || 50,
    ),
    market_score: parsePercent(data.market_score, lockedSetup.market_score || 50),
    bias: toAsciiDigits(data.bias || lockedSetup.bias || "خنثی").trim(),
    changes: asArray(data.changes).map((item) => toAsciiDigits(item).trim()).slice(0, 8),
    rationale: toAsciiDigits(data.rationale || "").trim(),
    result: toAsciiDigits(data.result || "").trim(),
    // Freeze trade levels from morning setup.
    entry: lockedSetup.entry,
    stop_loss: lockedSetup.stop_loss,
    tp1: lockedSetup.tp1,
    tp2: lockedSetup.tp2,
    tp3: lockedSetup.tp3,
    supports: lockedSetup.supports || [],
    resistances: lockedSetup.resistances || [],
    invalidation_hit: Boolean(data.invalidation_hit) || status === "Invalidated",
    summary: toAsciiDigits(data.summary || data.result || "").trim(),
  };
}

module.exports = {
  normalizeDailySetup,
  normalizeSetupEvaluation,
};
