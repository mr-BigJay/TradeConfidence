const fs = require("node:fs");
const path = require("node:path");
const config = require("../config/config");

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

function formatDateFa(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  } catch (error) {
    return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

/**
 * Deep desk-style Persian report matching the user's preferred ChatGPT format.
 */
function formatDeepAnalysisMessage(analysis) {
  const fundamentals = (analysis.fundamentals || [])
    .map(
      (item) =>
        `${toneEmoji(item.tone)} ${item.title}\n${item.text}${
          item.weight ? `\nوزن: ${item.weight}` : ""
        }`,
    )
    .join("\n\n");

  const longWarnings = joinLines(analysis.technical_long_term?.warnings || [], "❌");
  const longPositives = joinLines(analysis.technical_long_term?.positives || [], "✅");
  const shortPoints = joinLines(analysis.technical_short_term?.points || [], "•");
  const battlePoints = joinLines(analysis.market_battle_points || [], "•");
  const comparison = joinLines(analysis.previous_report_comparison || [], "•");
  const indicators = (analysis.indicators || [])
    .map((item) => `${toneEmoji(item.tone)} ${item.name}: ${item.status}`)
    .join("\n");

  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines((longConfirm.how || []).slice(0, 3), "•");
  const shortHow = joinLines((shortConfirm.how || []).slice(0, 3), "•");

  const supports = joinLines(analysis.key_support || [], "🟢") || "نامشخص";
  const resistances = joinLines(analysis.key_resistance || [], "🔴") || "نامشخص";

  return [
    `# ${analysis.title || "تحلیل اختصاصی BTC"}`,
    "",
    `تاریخ: ${formatDateFa()}`,
    `بایاس: ${analysis.bias || "خنثی"} | اطمینان: ${analysis.confidence || 0}% | قیمت: ${analysis.current_price || "-"}`,
    analysis.long_score !== null && analysis.long_score !== undefined
      ? `امتیاز لانگ: ${analysis.long_score}/10 | امتیاز شورت: ${analysis.short_score ?? "-"}/10`
      : "",
    "",
    "# خلاصه بازار",
    analysis.market_summary || analysis.summary || "نامشخص",
    battlePoints ? `\nنبرد اصلی بازار:\n${battlePoints}` : "",
    "",
    "# تحلیل فاندامنتال",
    fundamentals || "داده‌ای در گزارش پژوهشی نبود",
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
    supports,
    "",
    "## مقاومت‌ها",
    resistances,
    analysis.current_range ? `\nمحدوده فعلی: ${analysis.current_range}` : "",
    "",
    "# سناریوهای احتمالی",
    "",
    `## 🔴 سناریوی نزولی (${analysis.bearish_scenario_probability || 0}%)`,
    analysis.bearish_scenario || "نامشخص",
    analysis.bearish_targets?.length ? `اهداف: ${analysis.bearish_targets.join(" | ")}` : "",
    "",
    Number(analysis.neutral_scenario_probability) > 0
      ? `## 🟠 سناریوی خنثی (${analysis.neutral_scenario_probability}%)\n${analysis.neutral_scenario || "نامشخص"}\n`
      : "",
    `## 🟢 سناریوی صعودی (${analysis.bullish_scenario_probability || 0}%)`,
    analysis.bullish_scenario || "نامشخص",
    analysis.bullish_targets?.length ? `اهداف: ${analysis.bullish_targets.join(" | ")}` : "",
    "",
    "# ارزیابی اندیکاتورها",
    indicators || "نامشخص",
    "",
    comparison ? `# مقایسه با گزارش قبلی\n${comparison}\n` : "",
    "# تأیید سناریوها",
    "",
    "## لانگ",
    `کجا: ${longConfirm.zone || "نامشخص"}`,
    longHow || "",
    longConfirm.invalidation ? `باطل‌کننده: ${longConfirm.invalidation}` : "",
    "",
    "## شورت",
    `کجا: ${shortConfirm.zone || "نامشخص"}`,
    shortHow || "",
    shortConfirm.invalidation ? `باطل‌کننده: ${shortConfirm.invalidation}` : "",
    "",
    "# جمع‌بندی نهایی",
    analysis.final_verdict || analysis.summary || "نامشخص",
    "",
    "**نتیجه:**",
    `• روند بلندمدت: ${analysis.long_term_trend || "نامشخص"}`,
    `• روند کوتاه‌مدت: ${analysis.short_term_trend || "نامشخص"}`,
    `• احتمال سناریوی نزولی: ${analysis.bearish_probability || analysis.bearish_scenario_probability || 0}%`,
    `• احتمال سناریوی صعودی: ${analysis.bullish_probability || analysis.bullish_scenario_probability || 0}%`,
    analysis.correction_probability
      ? `• احتمال ادامه اصلاح: ${analysis.correction_probability}%`
      : "",
    "",
    "# پیشنهاد مدیریت ریسک",
    analysis.trading_suggestion || analysis.short_term_strategy || "نامشخص",
    "",
    "⚠️ این گزارش سیگنال خرید/فروش قطعی نیست و فقط شرح وضعیت بازار است.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatCardCaption(analysis) {
  return [
    `${analysis.pair_label || analysis.symbol} | ${analysis.bias || "خنثی"} | ${analysis.confidence || 0}%`,
    `محدوده: ${analysis.current_range || "نامشخص"}`,
  ].join("\n");
}

function splitTelegramText(text, maxLength = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n# ", maxLength);
    if (cut < maxLength * 0.4) {
      cut = remaining.lastIndexOf("\n\n", maxLength);
    }
    if (cut < maxLength * 0.4) {
      cut = remaining.lastIndexOf("\n", maxLength);
    }
    if (cut < maxLength * 0.4) {
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
  const deepReport = formatDeepAnalysisMessage(analysis);

  if (imagePath) {
    await sendTelegramPhoto(imagePath, formatCardCaption(analysis));
  }

  // Deep desk report may need 1-2 Telegram messages; split on section headers only.
  for (const chunk of splitTelegramText(deepReport)) {
    await sendTelegramMessage(chunk);
  }
}

module.exports = {
  formatDeepAnalysisMessage,
  formatCardCaption,
  sendMarketStatus,
  sendTelegramMessage,
  sendTelegramPhoto,
};
