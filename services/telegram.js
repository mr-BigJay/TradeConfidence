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

function toneEmoji(tone) {
  if (tone === "bullish") return "🟢";
  if (tone === "bearish") return "🔴";
  return "🟠";
}

function joinLines(items, bullet = "•") {
  return (items || []).map((item) => `${bullet} ${item}`).join("\n");
}

function formatDeepAnalysisMessage(analysis) {
  const fundamentals = (analysis.fundamentals || [])
    .map(
      (item) =>
        `${toneEmoji(item.tone)} ${item.title}\n${item.text}`,
    )
    .join("\n\n");

  const longPositives = joinLines(analysis.technical_long_term?.positives || [], "✅");
  const longWarnings = joinLines(analysis.technical_long_term?.warnings || [], "⚠️");
  const shortPoints = joinLines(analysis.technical_short_term?.points || []);
  const battlePoints = joinLines(analysis.market_battle_points || []);

  const indicators = (analysis.indicators || [])
    .map((item) => `${toneEmoji(item.tone)} ${item.name}: ${item.status}`)
    .join("\n");

  return [
    `# ${analysis.title || "تحلیل اختصاصی BTC"}`,
    "",
    `تاریخ: ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`,
    `بایاس: ${analysis.bias} | اطمینان: ${analysis.confidence}%`,
    "",
    "## خلاصه بازار",
    analysis.market_summary || analysis.summary || "نامشخص",
    battlePoints ? `\nنبرد اصلی بازار:\n${battlePoints}` : "",
    analysis.regime ? `\nفاز فعلی: ${analysis.regime}` : "",
    "",
    "# تحلیل فاندامنتال",
    fundamentals || "داده‌ای موجود نیست",
    "",
    "# تحلیل تکنیکال",
    "",
    "## روند بلندمدت",
    `وضعیت: ${analysis.technical_long_term?.bias || analysis.long_term_trend || "نامشخص"}`,
    analysis.technical_long_term?.text || "",
    longPositives ? `\nنکات مثبت:\n${longPositives}` : "",
    longWarnings ? `\nهشدارها:\n${longWarnings}` : "",
    "",
    "## روند کوتاه‌مدت",
    `وضعیت: ${analysis.technical_short_term?.bias || analysis.short_term_trend || "نامشخص"}`,
    analysis.technical_short_term?.text || "",
    shortPoints ? `\n${shortPoints}` : "",
    "",
    "# سطوح مهم بازار",
    "",
    "## حمایت‌ها",
    joinLines(analysis.key_support || [], "🟢") || "نامشخص",
    "",
    "## مقاومت‌ها",
    joinLines(analysis.key_resistance || [], "🔴") || "نامشخص",
    "",
    `محدوده فعلی: ${analysis.current_range || "نامشخص"}`,
    "",
    "# سناریوهای احتمالی",
    "",
    `## 🟢 سناریوی صعودی (${analysis.bullish_scenario_probability || 0}%)`,
    analysis.bullish_scenario || "نامشخص",
    analysis.bullish_targets?.length ? `اهداف: ${analysis.bullish_targets.join(" | ")}` : "",
    "",
    Number(analysis.neutral_scenario_probability) > 0
      ? `## 🟠 سناریوی خنثی (${analysis.neutral_scenario_probability}%)\n${analysis.neutral_scenario || "نامشخص"}\n`
      : "",
    `## 🔴 سناریوی نزولی (${analysis.bearish_scenario_probability || 0}%)`,
    analysis.bearish_scenario || "نامشخص",
    analysis.bearish_targets?.length ? `اهداف: ${analysis.bearish_targets.join(" | ")}` : "",
    "",
    "# ارزیابی اندیکاتورها",
    indicators || "نامشخص",
    "",
    "# جمع‌بندی",
    analysis.final_verdict || analysis.summary || "نامشخص",
    "",
    "**نتیجه نهایی:**",
    `• روند بلندمدت: ${analysis.long_term_trend || "نامشخص"} با احتمال ${analysis.bullish_probability}%`,
    `• روند کوتاه‌مدت: ${analysis.short_term_trend || "نامشخص"}`,
    `• احتمال شکست مقاومت در ۲۴ تا ۴۸ ساعت آینده: ${analysis.breakout_probability_24_48h || 0}%`,
    `• احتمال اصلاح: ${analysis.correction_probability || analysis.bearish_probability || 0}%`,
    analysis.invalidation_level
      ? `• تا وقتی بالای ${analysis.invalidation_level} بماند، اصلاح‌ها بخشی از ساختار بزرگ‌تر دیده می‌شوند.`
      : "",
    "",
    "⚠️ این گزارش سیگنال خرید/فروش نیست و فقط تحلیل وضعیت بازار است.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatCardCaption(analysis) {
  return [
    `📊 ${analysis.pair_label || analysis.symbol} — کارت تحلیل وضعیت`,
    `بایاس: ${analysis.bias} | اطمینان: ${analysis.confidence}%`,
    `محدوده: ${analysis.current_range || "نامشخص"}`,
    "",
    "گزارش کامل در پیام بعدی ارسال می‌شود.",
    "⚠️ سیگنال خرید/فروش نیست.",
  ].join("\n");
}

function splitTelegramText(text, maxLength = 3500) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
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
  form.append("photo", new Blob([fs.readFileSync(absolutePath)], { type: "image/png" }), path.basename(absolutePath));

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
  const deepReport = formatDeepAnalysisMessage(analysis);
  const reportChunks = splitTelegramText(deepReport);

  if (imagePath) {
    await sendTelegramPhoto(imagePath, formatCardCaption(analysis));
  }

  for (const chunk of reportChunks) {
    await sendTelegramMessage(chunk);
  }

  return {
    imageSent: Boolean(imagePath),
    chunks: reportChunks.length,
  };
}

module.exports = {
  formatCardCaption,
  formatDeepAnalysisMessage,
  sendMarketStatus,
  sendTelegramMessage,
  sendTelegramPhoto,
};
