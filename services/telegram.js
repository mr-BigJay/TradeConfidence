const fs = require("node:fs");
const path = require("node:path");
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

async function sendTelegramPhoto(imagePath, caption) {
  requireTelegramConfig();

  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Telegram photo not found: ${absolutePath}`);
  }

  const form = new FormData();
  form.append("chat_id", String(config.telegram.chatId));
  form.append("caption", caption.slice(0, 1000));
  form.append("disable_notification", "false");

  const blob = new Blob([fs.readFileSync(absolutePath)], { type: "image/png" });
  form.append("photo", blob, path.basename(absolutePath));

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendPhoto`;
  const response = await fetch(url, {
    method: "POST",
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(`Telegram photo error: ${payload.description || response.statusText}`);
  }

  return payload;
}

async function sendMarketStatus(analysis, imagePath = null) {
  const caption = formatMarketStatusMessage(analysis);

  if (imagePath) {
    return sendTelegramPhoto(imagePath, caption);
  }

  return sendTelegramMessage(caption);
}

module.exports = {
  formatMarketStatusMessage,
  sendMarketStatus,
  sendTelegramMessage,
  sendTelegramPhoto,
};
