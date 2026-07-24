const config = require("../config/config");

function requireTelegramConfig() {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  if (!config.telegram.chatId) {
    throw new Error("TELEGRAM_CHAT_ID is missing");
  }
}

function formatList(items, fallback = "نامشخص") {
  if (!items || !items.length) {
    return fallback;
  }

  return items.join(" | ");
}

function formatMarketStatusMessage(analysis) {
  return [
    `📊 ${analysis.symbol} — تحلیل وضعیت بازار`,
    "",
    `روند: ${analysis.trend}`,
    `بایاس: ${analysis.bias}`,
    `اعتماد تحلیل: ${analysis.confidence}%`,
    "",
    `احتمال صعودی: ${analysis.bullish_probability}%`,
    `احتمال نزولی: ${analysis.bearish_probability}%`,
    "",
    `مقاومت‌ها: ${formatList(analysis.key_resistance)}`,
    `حمایت‌ها: ${formatList(analysis.key_support)}`,
    `محدوده فعلی: ${analysis.current_range}`,
    "",
    "سناریوی صعودی:",
    analysis.bullish_scenario || "نامشخص",
    "",
    "سناریوی خنثی / نوسانی:",
    analysis.neutral_scenario || "نامشخص",
    "",
    "سناریوی نزولی:",
    analysis.bearish_scenario || "نامشخص",
    "",
    "استراتژی کوتاه‌مدت:",
    analysis.short_term_strategy || "نامشخص",
    "",
    "استراتژی بلندمدت:",
    analysis.long_term_strategy || "نامشخص",
    "",
    `ریسک: ${analysis.risk_level}`,
    `نکات ریسک: ${analysis.risk_notes || "نامشخص"}`,
    "",
    "جمع‌بندی:",
    analysis.summary || "نامشخص",
    "",
    "⚠️ این پیام سیگنال خرید یا فروش نیست و فقط تحلیل وضعیت بازار است.",
  ].join("\n");
}

async function sendTelegramMessage(text) {
  requireTelegramConfig();

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(`Telegram error: ${payload.description || response.statusText}`);
  }

  return payload;
}

async function sendMarketStatus(analysis) {
  return sendTelegramMessage(formatMarketStatusMessage(analysis));
}

module.exports = {
  formatMarketStatusMessage,
  sendMarketStatus,
  sendTelegramMessage,
};
