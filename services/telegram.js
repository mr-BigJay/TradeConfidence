const fs = require("node:fs");
const path = require("node:path");
const config = require("../config/config");

const TELEGRAM_SINGLE_MESSAGE_LIMIT = 3500;

function requireTelegramConfig() {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!config.telegram.chatId) {
    throw new Error("TELEGRAM_CHAT_ID is missing");
  }
}

function joinLines(items, bullet = "•") {
  return (items || []).map((item) => `${bullet} ${item}`).join("\n");
}

function clip(text, max) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * One compact Telegram message explaining the research roadmap only.
 * Never mention exchange brand names in user-facing text.
 */
function formatDeepAnalysisMessage(analysis) {
  const battlePoints = joinLines((analysis.market_battle_points || []).slice(0, 3), "•");
  const supports = (analysis.key_support || []).slice(0, 3).join(" | ") || "نامشخص";
  const resistances = (analysis.key_resistance || []).slice(0, 3).join(" | ") || "نامشخص";

  const roadmap = clip(
    analysis.market_summary || analysis.summary || analysis.final_verdict || "نامشخص",
    520,
  );
  const verdict = clip(analysis.final_verdict || analysis.summary || "نامشخص", 300);

  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines((longConfirm.how || []).slice(0, 3), "•");
  const shortHow = joinLines((shortConfirm.how || []).slice(0, 3), "•");

  const scoreLine =
    analysis.long_score !== null && analysis.long_score !== undefined
      ? `لانگ ${analysis.long_score}/10 | شورت ${analysis.short_score ?? "-"}/10`
      : null;

  const message = [
    `${analysis.pair_label || analysis.symbol} — وضعیت بازار`,
    `بایاس: ${analysis.bias || "خنثی"} | اطمینان: ${analysis.confidence || 0}% | قیمت: ${analysis.current_price || "-"}`,
    scoreLine || "",
    "",
    "شرح تحلیل پژوهشی",
    roadmap,
    battlePoints ? `\nنکات کلیدی:\n${battlePoints}` : "",
    "",
    "سطوح",
    `حمایت: ${supports}`,
    `مقاومت: ${resistances}`,
    analysis.current_range ? `محدوده: ${analysis.current_range}` : "",
    "",
    "سناریو",
    `🟢 صعودی ${analysis.bullish_scenario_probability || 0}% — ${clip(analysis.bullish_scenario, 180)}`,
    Number(analysis.neutral_scenario_probability) > 0
      ? `🟠 خنثی ${analysis.neutral_scenario_probability}% — ${clip(analysis.neutral_scenario, 120)}`
      : "",
    `🔴 نزولی ${analysis.bearish_scenario_probability || 0}% — ${clip(analysis.bearish_scenario, 180)}`,
    "",
    "تأیید لانگ",
    `کجا: ${clip(longConfirm.zone, 120)}`,
    longHow || "",
    longConfirm.invalidation ? `باطل: ${clip(longConfirm.invalidation, 100)}` : "",
    "",
    "تأیید شورت",
    `کجا: ${clip(shortConfirm.zone, 120)}`,
    shortHow || "",
    shortConfirm.invalidation ? `باطل: ${clip(shortConfirm.invalidation, 100)}` : "",
    "",
    "جمع‌بندی",
    verdict,
    "",
    "⚠️ دستور ورود نیست؛ فقط شرح وضعیت و شرایط تأیید سناریو.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return clip(message, TELEGRAM_SINGLE_MESSAGE_LIMIT);
}

function formatCardCaption(analysis) {
  const score =
    analysis.long_score !== null && analysis.long_score !== undefined
      ? ` | L${analysis.long_score}/S${analysis.short_score ?? "-"}`
      : "";

  return clip(
    `${analysis.pair_label || analysis.symbol} | ${analysis.bias || "خنثی"} | ${analysis.confidence || 0}%${score}`,
    200,
  );
}

async function sendTelegramMessage(text) {
  requireTelegramConfig();

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram sendMessage failed: ${payload.description || response.status}`);
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

  await sendTelegramMessage(report);
}

module.exports = {
  formatDeepAnalysisMessage,
  formatCardCaption,
  sendMarketStatus,
  sendTelegramMessage,
  sendTelegramPhoto,
};
