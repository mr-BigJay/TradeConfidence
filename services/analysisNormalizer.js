function asArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== null && item !== "").map(String);
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [String(value)];
}

function asTone(value, fallback = "neutral") {
  return ["bullish", "bearish", "neutral"].includes(value) ? value : fallback;
}

function asInsights(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 4).map((item) => ({
    title: item?.title || "نکته",
    text: item?.text || "",
    tone: asTone(item?.tone),
  }));
}

function asIndicators(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 7).map((item) => ({
    name: item?.name || "Indicator",
    status: item?.status || "نامشخص",
    tone: asTone(item?.tone),
  }));
}

function asFundamentals(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).map((item) => ({
    title: item?.title || "عامل",
    text: item?.text || "",
    tone: asTone(item?.tone),
    weight: ["high", "medium", "low"].includes(item?.weight) ? item.weight : "medium",
  }));
}

function normalizeAnalysis(symbol, analysis) {
  const pairLabel =
    analysis.pair_label ||
    (symbol.endsWith("USDT") ? `${symbol.slice(0, -4)} / USDT` : symbol);

  const technicalLong = analysis.technical_long_term || {};
  const technicalShort = analysis.technical_short_term || {};

  return {
    title: analysis.title || "تحلیل اختصاصی BTC",
    symbol,
    pair_label: pairLabel,
    trend: analysis.trend || analysis.bias || "Neutral",
    bias: analysis.bias || "خنثی",
    confidence: Number.parseInt(analysis.confidence, 10) || 0,
    current_price: analysis.current_price || "",
    market_summary: analysis.market_summary || analysis.summary || "",
    market_battle_points: asArray(analysis.market_battle_points).slice(0, 4),
    regime: analysis.regime || "Consolidation",
    fundamentals: asFundamentals(analysis.fundamentals),
    technical_long_term: {
      bias: technicalLong.bias || analysis.long_term_trend || "نامشخص",
      positives: asArray(technicalLong.positives).slice(0, 5),
      warnings: asArray(technicalLong.warnings).slice(0, 5),
      text: technicalLong.text || "",
    },
    technical_short_term: {
      bias: technicalShort.bias || analysis.short_term_trend || "نامشخص",
      points: asArray(technicalShort.points).slice(0, 6),
      text: technicalShort.text || "",
    },
    bullish_probability: Number.parseInt(analysis.bullish_probability, 10) || 50,
    bearish_probability: Number.parseInt(analysis.bearish_probability, 10) || 50,
    breakout_probability_24_48h: Number.parseInt(analysis.breakout_probability_24_48h, 10) || 0,
    correction_probability: Number.parseInt(analysis.correction_probability, 10) || 0,
    invalidation_level: analysis.invalidation_level || "",
    short_term_trend: analysis.short_term_trend || "نامشخص",
    long_term_trend: analysis.long_term_trend || "نامشخص",
    structure: analysis.structure || "نامشخص",
    volume_status: analysis.volume_status || "نامشخص",
    momentum_status: analysis.momentum_status || "نامشخص",
    current_range: analysis.current_range || "نامشخص",
    key_resistance: asArray(analysis.key_resistance).slice(0, 3),
    key_support: asArray(analysis.key_support).slice(0, 3),
    insights: asInsights(analysis.insights),
    bullish_scenario: analysis.bullish_scenario || "",
    bullish_scenario_probability: Number.parseInt(analysis.bullish_scenario_probability, 10) || 0,
    bullish_targets: asArray(analysis.bullish_targets).slice(0, 3),
    neutral_scenario: analysis.neutral_scenario || "",
    neutral_scenario_probability: Number.parseInt(analysis.neutral_scenario_probability, 10) || 0,
    bearish_scenario: analysis.bearish_scenario || "",
    bearish_scenario_probability: Number.parseInt(analysis.bearish_scenario_probability, 10) || 0,
    bearish_targets: asArray(analysis.bearish_targets).slice(0, 3),
    indicators: asIndicators(analysis.indicators),
    short_term_strategy: analysis.short_term_strategy || "",
    long_term_strategy: analysis.long_term_strategy || "",
    final_verdict: analysis.final_verdict || analysis.summary || "",
    risk_level: analysis.risk_level || "Medium",
    risk_notes: analysis.risk_notes || "",
    trading_action: "NO_SIGNAL",
    summary: analysis.summary || "",
  };
}

module.exports = {
  normalizeAnalysis,
};
