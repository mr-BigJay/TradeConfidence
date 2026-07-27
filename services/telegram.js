const fs = require("node:fs");
const path = require("node:path");
const config = require("../config/config");
const { clipText } = require("./numberFormat");

const TELEGRAM_MESSAGE_LIMIT = 3900;

function requireTelegramConfig() {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!config.telegram.chatId) {
    throw new Error("TELEGRAM_CHAT_ID is missing");
  }
}

function toneEmoji(tone) {
  if (tone === "bullish") return "🟢";
  if (tone === "bearish") return "🔴";
  return "🟠";
}

function joinLines(items, bullet = "•") {
  return (items || []).map((item) => `${bullet} ${item}`).join("\n");
}

function clip(text, max) {
  return clipText(text, max);
}

function splitTelegramText(text, maxLength = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n\n", maxLength);
    if (cut < maxLength * 0.45) {
      cut = remaining.lastIndexOf("\n", maxLength);
    }
    if (cut < maxLength * 0.45) {
      cut = maxLength;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Practical Persian market-status report (preferred compact style).
 */
function formatDeepAnalysisMessage(analysis) {
  const supports = (analysis.key_support || []).slice(0, 3).join(" | ") || "نامشخص";
  const resistances = (analysis.key_resistance || []).slice(0, 3).join(" | ") || "نامشخص";
  const battlePoints = joinLines((analysis.market_battle_points || []).slice(0, 3), "•");

  const fundamentals = (analysis.fundamentals || [])
    .slice(0, 3)
    .map((item) => `${toneEmoji(item.tone)} ${item.title}\n${clip(item.text, 260)}`)
    .join("\n\n");

  const longTech = clip(analysis.technical_long_term?.text || "", 280);
  const shortTech = clip(analysis.technical_short_term?.text || "", 280);
  const longWarnings = joinLines((analysis.technical_long_term?.warnings || []).slice(0, 3), "•");
  const shortPoints = joinLines((analysis.technical_short_term?.points || []).slice(0, 3), "•");

  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines((longConfirm.how || []).slice(0, 3), "•");
  const shortHow = joinLines((shortConfirm.how || []).slice(0, 3), "•");

  const whatToDo = clip(
    analysis.trading_suggestion || analysis.short_term_strategy || analysis.final_verdict || "",
    380,
  );

  const verdict = clip(analysis.final_verdict || analysis.summary || "", 380);

  const parts = [
    `${analysis.pair_label || analysis.symbol} — تحلیل وضعیت بازار`,
    `بایاس: ${analysis.bias || "خنثی"} | اطمینان: ${analysis.confidence || 0}% | قیمت: ${analysis.current_price || "-"}`,
    "",
    "وضعیت فعلی",
    clip(analysis.market_summary || analysis.summary || "نامشخص", 700),
    battlePoints ? `نکات کلیدی:\n${battlePoints}` : null,
    "",
    fundamentals ? `عوامل مهم:\n${fundamentals}` : null,
    "",
    "نگاه تکنیکال",
    longTech
      ? `بلندمدت (${analysis.technical_long_term?.bias || analysis.long_term_trend || "نامشخص"}):\n${longTech}`
      : null,
    longWarnings || null,
    shortTech
      ? `\nکوتاه‌مدت (${analysis.technical_short_term?.bias || analysis.short_term_trend || "نامشخص"}):\n${shortTech}`
      : null,
    shortPoints || null,
    "",
    "سطوح مهم",
    `حمایت: ${supports}`,
    `مقاومت: ${resistances}`,
    analysis.current_range ? `محدوده: ${analysis.current_range}` : null,
    "",
    "الان چه کار کنی؟",
    whatToDo || "عجله نکن و همین سطوح را رصد کن.",
    "",
    "سناریوها",
    `🔴 نزولی (${analysis.bearish_scenario_probability || 0}%):\n${clip(analysis.bearish_scenario, 280)}`,
    analysis.bearish_targets?.length ? `اهداف: ${analysis.bearish_targets.join(" | ")}` : null,
    "",
    `🟢 صعودی (${analysis.bullish_scenario_probability || 0}%):\n${clip(analysis.bullish_scenario, 280)}`,
    analysis.bullish_targets?.length ? `اهداف: ${analysis.bullish_targets.join(" | ")}` : null,
    "",
    "چطور ورود تأیید می‌شود؟",
    "",
    "🟢 لانگ",
    `کجا: ${clip(longConfirm.zone, 160)}`,
    longHow ? `چطور:\n${longHow}` : null,
    longConfirm.invalidation ? `باطل اگر: ${clip(longConfirm.invalidation, 160)}` : null,
    "",
    "🔴 شورت",
    `کجا: ${clip(shortConfirm.zone, 160)}`,
    shortHow ? `چطور:\n${shortHow}` : null,
    shortConfirm.invalidation ? `باطل اگر: ${clip(shortConfirm.invalidation, 160)}` : null,
    "",
    "جمع‌بندی",
    verdict || "نامشخص",
    "",
    "⚠️ سیگنال قطعی خرید/فروش نیست؛ راهنمای رصد سناریو است.",
  ];

  return parts.filter((line) => line != null && line !== "").join("\n");
}

function formatCardCaption(analysis) {
  return clip(
    `${analysis.pair_label || analysis.symbol} | ${analysis.bias || "خنثی"} | ${analysis.confidence || 0}%`,
    180,
  );
}

async function sendTelegramMessage(text) {
  requireTelegramConfig();

  const cleaned = String(text || "").trim();
  if (!cleaned) {
    throw new Error("Telegram sendMessage refused empty text");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text: cleaned.slice(0, 4096),
        disable_web_page_preview: true,
      }),
    },
  );

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${payload.description || response.status} (chat_id=${config.telegram.chatId})`,
    );
  }

  return payload;
}

async function sendTelegramPhoto(imagePath, caption) {
  requireTelegramConfig();

  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Telegram photo missing: ${absolutePath}`);
  }

  const form = new FormData();
  form.append("chat_id", config.telegram.chatId);
  form.append("caption", caption || "");
  form.append("photo", new Blob([fs.readFileSync(absolutePath)]), path.basename(absolutePath));

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.botToken}/sendPhoto`,
    {
      method: "POST",
      body: form,
    },
  );

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram sendPhoto failed: ${payload.description || response.status}`);
  }

  return payload;
}

async function sendMarketStatus(analysis, imagePath = null) {
  const report = formatDeepAnalysisMessage(analysis);

  if (imagePath) {
    await sendTelegramPhoto(imagePath, formatCardCaption(analysis));
  }

  for (const chunk of splitTelegramText(report)) {
    await sendTelegramMessage(chunk);
  }
}

function statusEmoji(status) {
  if (status === "Invalidated") return "❌";
  if (status === "Weakening") return "⚠️";
  return "🟢";
}

function formatDailySetupMessage(setup, meta = {}) {
  const supports = (setup.supports || []).join(" | ") || "نامشخص";
  const resistances = (setup.resistances || []).join(" | ") || "نامشخص";
  return [
    "BTC Daily Setup",
    meta.iranDate ? `تاریخ: ${meta.iranDate} (به وقت ایران)` : null,
    "",
    `Bias: ${setup.bias || "خنثی"}`,
    `Direction: ${setup.direction || "RANGE"}`,
    `Confidence: ${setup.confidence ?? 0}%`,
    `Market Score: ${setup.market_score ?? 0}/100`,
    `Risk Level: ${setup.risk_level || "Medium"}`,
    "",
    "Main Scenario",
    setup.main_scenario || setup.summary || "نامشخص",
    "",
    `Entry: ${setup.entry || "نامشخص"}`,
    `Stop Loss: ${setup.stop_loss || "نامشخص"}`,
    `TP1: ${setup.tp1 || "-"}`,
    `TP2: ${setup.tp2 || "-"}`,
    `TP3: ${setup.tp3 || "-"}`,
    "",
    `Important Supports: ${supports}`,
    `Important Resistances: ${resistances}`,
    setup.invalidation ? `\nInvalidation: ${setup.invalidation}` : null,
    "",
    "این ستاپ تا پایان روز معتبر است (مگر باطل شود).",
    "⚠️ هنوز اجرای خودکار نیست؛ فقط ستاپ و رصد است.",
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

function formatDailyTradingPlanMessage(plan, meta = {}) {
  const futures = plan.futures_analysis || {};
  const options = plan.options_analysis || {};
  const technical = plan.technical_analysis || {};
  const warnings = joinLines(plan.risk_warnings || [], "•");
  const executionNotes = joinLines(plan.execution_notes || [], "•");
  const validation = plan.coinex_validation_status || meta.validation?.status || "Partially Confirmed";
  const components = meta.engineScore?.components;

  return [
    "BTC Daily Trading Plan",
    meta.iranDate ? `تاریخ: ${meta.iranDate} (ایران)` : null,
    "",
    "========================",
    "Market Overview",
    "========================",
    `Current Price: ${plan.current_price || "-"}`,
    `Bias: ${plan.bias || "Neutral"}`,
    `Regime: ${plan.market_regime || "-"}`,
    `Confidence: ${plan.confidence ?? 0}%`,
    `Market Score: ${plan.market_score ?? 0}/100`,
    `Risk Level: ${plan.risk_level || "Medium"}`,
    components
      ? `Score Mix: CoinEx ${components.coinex} | Futures ${components.futures} | Options ${components.options} | Tech ${components.technical} | Pattern ${components.pattern} | Risk ${components.risk}`
      : null,
    "",
    "========================",
    "Narrative Analysis",
    "========================",
    plan.coinex_summary || plan.main_scenario || "-",
    `Validation: ${validation}`,
    "",
    "========================",
    "Futures Analysis",
    "========================",
    `Funding: ${futures.funding_status || "-"}`,
    `OI: ${futures.oi_status || "-"}`,
    `CVD: ${futures.cvd_status || "-"}`,
    `Smart Money: ${futures.smart_money_status || "-"}`,
    `Liquidation Risk: ${futures.liquidation_risk || "-"}`,
    "",
    "========================",
    "Options Analysis",
    "========================",
    `PCR: ${options.pcr || "-"}`,
    `Max Pain: ${options.max_pain || "-"}`,
    `Gamma: ${options.gamma_exposure || "-"}`,
    `IV: ${options.iv || "-"}`,
    `Dealer: ${options.dealer_position || "-"}`,
    "",
    "========================",
    "Technical / Chart",
    "========================",
    `MTF: ${technical.mtf_summary || "-"}`,
    `Structure: ${technical.market_structure || "-"}`,
    `Major Support: ${technical.major_support || "-"}`,
    `Major Resistance: ${technical.major_resistance || "-"}`,
    `Indicators: ${technical.indicators_status || "-"}`,
    `Volume: ${technical.volume_status || "-"}`,
    `Pattern: ${technical.pattern || "-"}`,
    `Fibonacci: ${technical.fibonacci || "-"}`,
    `Liquidity: ${technical.liquidity_notes || "-"}`,
    technical.chart_setup_status ? `Chart Gate: ${technical.chart_setup_status}` : null,
    meta.engineScore?.chart_setup
      ? `Confirmations: Market=${meta.engineScore.chart_setup.market_confirmation ? "OK" : "NO"} | Technical=${meta.engineScore.chart_setup.technical_confirmation ? "OK" : "NO"} | Risk=${meta.engineScore.chart_setup.risk_confirmation ? "OK" : "NO"}`
      : null,
    "",
    "========================",
    "Trading Setup",
    "========================",
    `Direction: ${plan.direction || "-"}`,
    `Entry Zone: ${plan.entry || "-"}`,
    `TP1: ${plan.tp1 || "-"}`,
    `TP2: ${plan.tp2 || "-"}`,
    `TP3: ${plan.tp3 || "-"}`,
    `Stop Loss: ${plan.stop_loss || "-"}`,
    `Risk Reward: ${plan.risk_reward || "-"}`,
    `Confidence Score: ${plan.confidence ?? 0}/100`,
    "",
    "Reason",
    plan.reason || plan.main_scenario || "-",
    "",
    "========================",
    "Alternative Scenario",
    "========================",
    plan.alternative_scenario || "-",
    `Invalidation: ${plan.invalidation_level || "-"}`,
    `Reversal Trigger: ${plan.reversal_trigger || "-"}`,
    executionNotes ? `\nExecution Notes\n${executionNotes}` : null,
    "",
    "========================",
    "Risk Warning",
    "========================",
    warnings || "• Risk management required",
    "",
    "⚠️ Pattern alone is not a trade. Final plan needs Market + Technical + Risk confirmation.",
    "⚠️ سیگنال اجرای خودکار نیست؛ Trading Plan برای تصمیم انسانی/تست است.",
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

function formatSetupUpdateMessage(evaluation, setup, meta = {}) {
  const changes = joinLines((evaluation.changes || []).slice(0, 8), "•");
  const confidenceLine =
    evaluation.previous_confidence !== undefined &&
    evaluation.previous_confidence !== evaluation.confidence
      ? `Confidence: ${evaluation.previous_confidence}% → ${evaluation.confidence}%`
      : `Confidence: ${evaluation.confidence ?? 0}%`;

  return [
    "BTC Update",
    meta.clock ? meta.clock : null,
    "",
    "Status",
    `${statusEmoji(evaluation.setup_status)} ${evaluation.setup_status}`,
    "",
    confidenceLine,
    `Market Score: ${evaluation.market_score ?? 0}/100`,
    "",
    "Locked Setup",
    `Entry: ${setup.entry}`,
    `SL: ${setup.stop_loss} | TP1: ${setup.tp1 || "-"} | TP2: ${setup.tp2 || "-"} | TP3: ${setup.tp3 || "-"}`,
    "",
    changes ? `Changes\n${changes}` : null,
    "",
    "نتیجه",
    evaluation.result || evaluation.rationale || evaluation.summary || "نامشخص",
    evaluation.setup_status === "Invalidated"
      ? "\nستاپ روزانه دیگر معتبر نیست."
      : "\nEntry/SL/TP جدید تولید نشده؛ فقط وضعیت ستاپ صبح بررسی شده است.",
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

async function sendDailySetup(setup, meta = {}) {
  for (const chunk of splitTelegramText(formatDailySetupMessage(setup, meta))) {
    await sendTelegramMessage(chunk);
  }
}

async function sendDailyTradingPlan(plan, meta = {}) {
  const chunks = splitTelegramText(formatDailyTradingPlanMessage(plan, meta));
  const results = [];
  for (const chunk of chunks) {
    results.push(await sendTelegramMessage(chunk));
  }
  return results;
}

async function sendSetupUpdate(evaluation, setup, meta = {}) {
  const chunks = splitTelegramText(formatSetupUpdateMessage(evaluation, setup, meta));
  const results = [];
  for (const chunk of chunks) {
    results.push(await sendTelegramMessage(chunk));
  }
  return results;
}

async function sendTelegramTest(text = "BTC Analyzer test message ✅") {
  return sendTelegramMessage(text);
}

module.exports = {
  formatDeepAnalysisMessage,
  formatCardCaption,
  formatDailySetupMessage,
  formatDailyTradingPlanMessage,
  formatSetupUpdateMessage,
  sendMarketStatus,
  sendDailySetup,
  sendDailyTradingPlan,
  sendSetupUpdate,
  sendTelegramMessage,
  sendTelegramPhoto,
  sendTelegramTest,
};
