const fs = require("node:fs");
const path = require("node:path");
const config = require("../config/config");

const TELEGRAM_MESSAGE_LIMIT = 3500;

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
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * Short practical Persian note:
 * what is happening + what user should do + simple long/short confirmations.
 */
function formatDeepAnalysisMessage(analysis) {
  const supports = (analysis.key_support || []).slice(0, 3).join(" | ") || "نامشخص";
  const resistances = (analysis.key_resistance || []).slice(0, 3).join(" | ") || "نامشخص";
  const battlePoints = joinLines((analysis.market_battle_points || []).slice(0, 2), "•");
  const fundamentals = (analysis.fundamentals || [])
    .slice(0, 3)
    .map((item) => `${toneEmoji(item.tone)} ${item.title}: ${clip(item.text, 90)}`)
    .join("\n");

  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines((longConfirm.how || []).slice(0, 3), "•");
  const shortHow = joinLines((shortConfirm.how || []).slice(0, 3), "•");

  const whatToDo = clip(
    analysis.trading_suggestion || analysis.short_term_strategy || analysis.final_verdict || "",
    220,
  );

  const message = [
    `${analysis.pair_label || analysis.symbol} — وضعیت بازار`,
    `بایاس: ${analysis.bias || "خنثی"} | اطمینان: ${analysis.confidence || 0}% | قیمت: ${analysis.current_price || "-"}`,
    "",
    "الان بازار چه وضعی دارد؟",
    clip(analysis.market_summary || analysis.summary || "نامشخص", 220),
    battlePoints ? `\n${battlePoints}` : "",
    "",
    fundamentals ? `نکات مهم:\n${fundamentals}\n` : "",
    "سطوح مهم",
    `حمایت: ${supports}`,
    `مقاومت: ${resistances}`,
    analysis.current_range ? `محدوده: ${analysis.current_range}` : "",
    "",
    "کاربر الان چه کار کند؟",
    whatToDo || "صبر کند و سطوح بالا را رصد کند.",
    "",
    "سناریوها",
    `🔴 شورت/نزولی (${analysis.bearish_scenario_probability || 0}%): ${clip(analysis.bearish_scenario, 120)}`,
    `🟢 لانگ/صعودی (${analysis.bullish_scenario_probability || 0}%): ${clip(analysis.bullish_scenario, 120)}`,
    "",
    "چطور ورود تأیید می‌شود؟",
    "",
    `🟢 لانگ`,
    `کجا: ${clip(longConfirm.zone, 100)}`,
    longHow ? `چطور:\n${longHow}` : "",
    longConfirm.invalidation ? `باطل اگر: ${clip(longConfirm.invalidation, 90)}` : "",
    "",
    `🔴 شورت`,
    `کجا: ${clip(shortConfirm.zone, 100)}`,
    shortHow ? `چطور:\n${shortHow}` : "",
    shortConfirm.invalidation ? `باطل اگر: ${clip(shortConfirm.invalidation, 90)}` : "",
    "",
    "⚠️ دستور خرید/فروش نیست؛ فقط راهنمای رصد و تأیید سناریو.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return clip(message, TELEGRAM_MESSAGE_LIMIT);
}

function formatCardCaption(analysis) {
  return clip(
    `${analysis.pair_label || analysis.symbol} | ${analysis.bias || "خنثی"} | ${analysis.confidence || 0}%`,
    180,
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

  // Keep as one practical Telegram message.
  await sendTelegramMessage(report);
}

module.exports = {
  formatDeepAnalysisMessage,
  formatCardCaption,
  sendMarketStatus,
  sendTelegramMessage,
  sendTelegramPhoto,
};
