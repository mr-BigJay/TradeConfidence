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
    how: uniqueStrings(block.how || block.conditions || [], 3),
    invalidation: String(block.invalidation || "").trim(),
  };
}

const BRAND_REPLACEMENTS = [
  [/coinglass/gi, "داده‌های مشتقه"],
  [/bitunix/gi, "داده‌های مشتقه"],
  [/coinex/gi, "تحلیل پژوهشی"],
  [/بیت\s*یونیکس/g, "داده‌های مشتقه"],
  [/بیتونیکس/g, "داده‌های مشتقه"],
  [/کوین\s*گلس/g, "داده‌های مشتقه"],
  [/کوینکس/g, "تحلیل پژوهشی"],
];

function stripBrandNames(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  let text = value;
  for (const [pattern, replacement] of BRAND_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    return stripBrandNames(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeValue(nested);
    }
    return out;
  }
  return value;
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
  const clean = sanitizeValue(analysis || {});
  const pairLabel =
    clean.pair_label ||
    (symbol.endsWith("USDT") ? `${symbol.slice(0, -4)} / USDT` : symbol);

  const technicalLong = clean.technical_long_term || {};
  const technicalShort = clean.technical_short_term || {};
  const texts = pickDistinctSummary(clean);

  return {
    title: clean.title || "تحلیل اختصاصی BTC",
    symbol,
    pair_label: pairLabel,
    trend: clean.trend || clean.bias || "Neutral",
    bias: clean.bias || "خنثی",
    confidence: Number.parseInt(clean.confidence, 10) || 0,
    current_price: clean.current_price || "",
    market_summary: texts.market_summary,
    market_battle_points: uniqueStrings(clean.market_battle_points, 3),
    regime: clean.regime || "Consolidation",
    derivatives_checklist: asChecklist(clean.derivatives_checklist),
    long_score: asScore(clean.long_score),
    short_score: asScore(clean.short_score),
    long_confirm: asConfirmBlock(clean.long_confirm, "منطقه تأیید لانگ مشخص نشده"),
    short_confirm: asConfirmBlock(clean.short_confirm, "منطقه تأیید شورت مشخص نشده"),
    confirmation_watch: uniqueStrings(clean.confirmation_watch, 4),
    previous_report_comparison: uniqueStrings(clean.previous_report_comparison, 5),
    trading_suggestion: clean.trading_suggestion || clean.short_term_strategy || "",
    fundamentals: asFundamentals(clean.fundamentals),
    technical_long_term: {
      bias: technicalLong.bias || clean.long_term_trend || "نامشخص",
      positives: uniqueStrings(technicalLong.positives, 5),
      warnings: uniqueStrings(technicalLong.warnings, 5),
      text: technicalLong.text || "",
    },
    technical_short_term: {
      bias: technicalShort.bias || clean.short_term_trend || "نامشخص",
      points: uniqueStrings(technicalShort.points, 6),
      text: technicalShort.text || "",
    },
    bullish_probability: Number.parseInt(clean.bullish_probability, 10) || 50,
    bearish_probability: Number.parseInt(clean.bearish_probability, 10) || 50,
    breakout_probability_24_48h: Number.parseInt(clean.breakout_probability_24_48h, 10) || 0,
    correction_probability: Number.parseInt(clean.correction_probability, 10) || 0,
    invalidation_level: clean.invalidation_level || "",
    short_term_trend: clean.short_term_trend || "نامشخص",
    long_term_trend: clean.long_term_trend || "نامشخص",
    structure: clean.structure || "نامشخص",
    volume_status: clean.volume_status || "نامشخص",
    momentum_status: clean.momentum_status || "نامشخص",
    current_range: clean.current_range || "نامشخص",
    key_resistance: uniqueStrings(clean.key_resistance, 3),
    key_support: uniqueStrings(clean.key_support, 3),
    insights: asInsights(clean.insights),
    bullish_scenario: clean.bullish_scenario || "",
    bullish_scenario_probability: Number.parseInt(clean.bullish_scenario_probability, 10) || 0,
    bullish_targets: uniqueStrings(clean.bullish_targets, 3),
    neutral_scenario: clean.neutral_scenario || "",
    neutral_scenario_probability: Number.parseInt(clean.neutral_scenario_probability, 10) || 0,
    bearish_scenario: clean.bearish_scenario || "",
    bearish_scenario_probability: Number.parseInt(clean.bearish_scenario_probability, 10) || 0,
    bearish_targets: uniqueStrings(clean.bearish_targets, 3),
    indicators: asIndicators(clean.indicators),
    short_term_strategy: clean.short_term_strategy || "",
    long_term_strategy: clean.long_term_strategy || "",
    final_verdict: texts.final_verdict,
    risk_level: clean.risk_level || "Medium",
    risk_notes: clean.risk_notes || "",
    trading_action: "NO_SIGNAL",
    summary: texts.summary,
  };
}

module.exports = {
  normalizeAnalysis,
  inferChecklistTone,
};
