function asArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String);
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [String(value)];
}

function asInsights(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 4).map((item) => ({
    title: item?.title || "نکته",
    text: item?.text || "",
    tone: ["bullish", "bearish", "neutral"].includes(item?.tone) ? item.tone : "neutral",
  }));
}

function asIndicators(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 7).map((item) => ({
    name: item?.name || "Indicator",
    status: item?.status || "نامشخص",
    tone: ["bullish", "bearish", "neutral"].includes(item?.tone) ? item.tone : "neutral",
  }));
}

function normalizeAnalysis(symbol, analysis) {
  const pairLabel =
    analysis.pair_label ||
    (symbol.endsWith("USDT") ? `${symbol.slice(0, -4)} / USDT` : symbol);

  return {
    title: analysis.title || `${symbol} وضعیت بازار`,
    symbol,
    pair_label: pairLabel,
    trend: analysis.trend || "Neutral",
    bias: analysis.bias || "خنثی",
    confidence: Number.parseInt(analysis.confidence, 10) || 0,
    bullish_probability: Number.parseInt(analysis.bullish_probability, 10) || 50,
    bearish_probability: Number.parseInt(analysis.bearish_probability, 10) || 50,
    short_term_trend: analysis.short_term_trend || analysis.bias || "نامشخص",
    long_term_trend: analysis.long_term_trend || "نامشخص",
    structure: analysis.structure || "نامشخص",
    volume_status: analysis.volume_status || "نامشخص",
    momentum_status: analysis.momentum_status || "نامشخص",
    current_price: analysis.current_price || "",
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
    risk_level: analysis.risk_level || "Medium",
    risk_notes: analysis.risk_notes || "",
    trading_action: "NO_SIGNAL",
    summary: analysis.summary || "",
  };
}

module.exports = {
  normalizeAnalysis,
};
