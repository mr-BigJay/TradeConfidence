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

function uniqueStrings(values, limit = 3) {
  const seen = new Set();
  const out = [];
  for (const value of asArray(values)) {
    const key = String(value).trim().replace(/,/g, "");
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(String(value).trim());
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

function uniqueByText(items, getKey, limit) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * Infer checklist tone from Persian/English result text.
 * Prefer explicit result wording over model-provided tone when they conflict.
 */
function inferChecklistTone(item) {
  const blob = `${item?.name || ""} ${item?.value || ""} ${item?.result || ""}`.toLowerCase();

  const bearHints =
    /شورت|نزولی|خروج سرمایه|فشار شورت|اشباع خرید|overheated|bearish|\bshort\b|↓/;
  const bullHints =
    /لانگ|صعودی|ورود سرمایه|نهنگ.*لانگ|bullish|\blong\b|↑/;

  const hasBear = bearHints.test(blob);
  const hasBull = bullHints.test(blob);

  // Funding positive crowding longs is bearish pressure even if "long" appears in name.
  if (/funding/.test(blob) && (/\+/.test(blob) || /مثبت/.test(blob))) {
    if (/شورت|فشار شورت|bearish|short/.test(blob)) {
      return "bearish";
    }
  }

  if (hasBear && !hasBull) {
    return "bearish";
  }
  if (hasBull && !hasBear) {
    return "bullish";
  }
  if (hasBear && hasBull) {
    // Prefer the result field alone.
    const result = String(item?.result || "").toLowerCase();
    if (/شورت|نزولی|خروج|bearish|short/.test(result)) return "bearish";
    if (/لانگ|صعودی|ورود|bullish|long/.test(result)) return "bullish";
  }

  return asTone(item?.tone, "neutral");
}

function normalizeChecklistName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .trim();
}

function asInsights(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueByText(
    value.map((item) => ({
      title: item?.title || "نکته",
      text: item?.text || "",
      tone: asTone(item?.tone),
    })),
    (item) => `${item.title}|${item.text}`.trim(),
    4,
  );
}

function asIndicators(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueByText(
    value.map((item) => ({
      name: item?.name || "Indicator",
      status: item?.status || "نامشخص",
      tone: asTone(item?.tone),
    })),
    (item) => item.name.toLowerCase(),
    7,
  );
}

function asFundamentals(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueByText(
    value.map((item) => ({
      title: item?.title || "عامل",
      text: item?.text || "",
      tone: asTone(item?.tone),
      weight: ["high", "medium", "low"].includes(item?.weight) ? item.weight : "medium",
    })),
    (item) => item.title.toLowerCase(),
    6,
  );
}

function asChecklist(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const mapped = value.map((item) => ({
    name: item?.name || "شاخص",
    value: item?.value || "-",
    result: item?.result || "نامشخص",
    tone: inferChecklistTone(item),
    note: item?.note || "",
  }));

  return uniqueByText(mapped, (item) => normalizeChecklistName(item.name), 6);
}

function asScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function asConfirmBlock(value, fallbackZone = "نامشخص") {
  const block = value && typeof value === "object" ? value : {};
  return {
    zone: String(block.zone || fallbackZone).trim() || fallbackZone,
    how: uniqueStrings(block.how || block.conditions || [], 5),
    invalidation: String(block.invalidation || "").trim(),
  };
}

function pickDistinctSummary(analysis) {
  const summary = String(analysis.summary || "").trim();
  const market = String(analysis.market_summary || "").trim();
  const verdict = String(analysis.final_verdict || "").trim();

  if (summary) {
    return {
      summary,
      market_summary: market && market !== summary ? market : summary,
      final_verdict: verdict && verdict !== summary ? verdict : summary,
    };
  }

  if (market) {
    return {
      summary: market,
      market_summary: market,
      final_verdict: verdict && verdict !== market ? verdict : market,
    };
  }

  return {
    summary: verdict,
    market_summary: verdict,
    final_verdict: verdict,
  };
}

function normalizeAnalysis(symbol, analysis) {
  const pairLabel =
    analysis.pair_label ||
    (symbol.endsWith("USDT") ? `${symbol.slice(0, -4)} / USDT` : symbol);

  const technicalLong = analysis.technical_long_term || {};
  const technicalShort = analysis.technical_short_term || {};
  const texts = pickDistinctSummary(analysis);

  return {
    title: analysis.title || "تحلیل اختصاصی BTC",
    symbol,
    pair_label: pairLabel,
    trend: analysis.trend || analysis.bias || "Neutral",
    bias: analysis.bias || "خنثی",
    confidence: Number.parseInt(analysis.confidence, 10) || 0,
    current_price: analysis.current_price || "",
    market_summary: texts.market_summary,
    market_battle_points: uniqueStrings(analysis.market_battle_points, 3),
    regime: analysis.regime || "Consolidation",
    derivatives_checklist: asChecklist(analysis.derivatives_checklist),
    long_score: asScore(analysis.long_score),
    short_score: asScore(analysis.short_score),
    long_confirm: asConfirmBlock(analysis.long_confirm, "منطقه تأیید لانگ مشخص نشده"),
    short_confirm: asConfirmBlock(analysis.short_confirm, "منطقه تأیید شورت مشخص نشده"),
    confirmation_watch: uniqueStrings(analysis.confirmation_watch, 4),
    fundamentals: asFundamentals(analysis.fundamentals),
    technical_long_term: {
      bias: technicalLong.bias || analysis.long_term_trend || "نامشخص",
      positives: uniqueStrings(technicalLong.positives, 5),
      warnings: uniqueStrings(technicalLong.warnings, 5),
      text: technicalLong.text || "",
    },
    technical_short_term: {
      bias: technicalShort.bias || analysis.short_term_trend || "نامشخص",
      points: uniqueStrings(technicalShort.points, 6),
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
    key_resistance: uniqueStrings(analysis.key_resistance, 3),
    key_support: uniqueStrings(analysis.key_support, 3),
    insights: asInsights(analysis.insights),
    bullish_scenario: analysis.bullish_scenario || "",
    bullish_scenario_probability: Number.parseInt(analysis.bullish_scenario_probability, 10) || 0,
    bullish_targets: uniqueStrings(analysis.bullish_targets, 3),
    neutral_scenario: analysis.neutral_scenario || "",
    neutral_scenario_probability: Number.parseInt(analysis.neutral_scenario_probability, 10) || 0,
    bearish_scenario: analysis.bearish_scenario || "",
    bearish_scenario_probability: Number.parseInt(analysis.bearish_scenario_probability, 10) || 0,
    bearish_targets: uniqueStrings(analysis.bearish_targets, 3),
    indicators: asIndicators(analysis.indicators),
    short_term_strategy: analysis.short_term_strategy || "",
    long_term_strategy: analysis.long_term_strategy || "",
    final_verdict: texts.final_verdict,
    risk_level: analysis.risk_level || "Medium",
    risk_notes: analysis.risk_notes || "",
    trading_action: "NO_SIGNAL",
    summary: texts.summary,
  };
}

module.exports = {
  normalizeAnalysis,
  inferChecklistTone,
};
