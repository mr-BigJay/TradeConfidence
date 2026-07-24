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

function toPersianDigits(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function joinLines(items, bullet = "•") {
  return (items || []).map((item) => `${bullet} ${item}`).join("\n");
}

function guessPointTone(point) {
  const text = String(point || "");
  if (/اشباع فروش|oversold/i.test(text)) return "neutral";
  if (/مثبت|صعود|قوی|حمایت حفظ|بازگشت/i.test(text)) return "bullish";
  if (/نزولی|ضعیف|زیر|Death Cross|منفی|شکست/i.test(text)) return "bearish";
  return "bearish";
}

function formatDateLine(date = new Date()) {
  const months = [
    "ژانویه",
    "فوریه",
    "مارس",
    "آوریل",
    "مه",
    "ژوئن",
    "ژوئیه",
    "اوت",
    "سپتامبر",
    "اکتبر",
    "نوامبر",
    "دسامبر",
  ];
  const day = toPersianDigits(date.getUTCDate());
  const month = months[date.getUTCMonth()];
  const year = toPersianDigits(date.getUTCFullYear());
  const hh = toPersianDigits(String(date.getUTCHours()).padStart(2, "0"));
  const mm = toPersianDigits(String(date.getUTCMinutes()).padStart(2, "0"));
  return `${day} ${month} ${year} - ساعت ${hh}:${mm} UTC`;
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
      cut = remaining.lastIndexOf("\n---\n", maxLength);
    }
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

/**
 * Full desk-style Persian report matching the user's preferred template.
 */
function formatDeepAnalysisMessage(analysis) {
  const fundamentals = (analysis.fundamentals || [])
    .map((item) => {
      const effect =
        item.tone === "bullish" ? "مثبت" : item.tone === "bearish" ? "منفی" : "خنثی/محتاطانه";
      return [
        `## ${toneEmoji(item.tone)} ${item.title}`,
        "",
        item.text || "",
        "",
        `اثر بر BTC: ${effect}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const longWarnings = joinLines(analysis.technical_long_term?.warnings || [], "❌");
  const longPositives = joinLines(analysis.technical_long_term?.positives || [], "✅");
  const shortPoints = (analysis.technical_short_term?.points || [])
    .map((point) => `${toneEmoji(guessPointTone(point))} ${point}`)
    .join("\n");

  const supports = (analysis.key_support || [])
    .map((level, index) =>
      index === 0 ? `${level} ⭐ حمایت بسیار مهم` : `${level} ⭐ هدف بعدی فروشندگان در صورت شکست حمایت`,
    )
    .join("\n\n");

  const resistances = (analysis.key_resistance || [])
    .map((level, index) =>
      index === 0 ? `${level} ⭐ مقاومت کلیدی` : `${level} ⭐ مقاومت اصلی روند`,
    )
    .join("\n\n");

  const indicators = (analysis.indicators || [])
    .map((item) => `${toneEmoji(item.tone)} ${item.name.padEnd(18, " ")} ${item.status}`)
    .join("\n");

  const comparison = (analysis.previous_report_comparison || [])
    .map((item) => {
      const text = String(item).trim();
      if (/^[✅❌⚠️]/.test(text)) return `• ${text}`;
      if (/امید|اشباع فروش|نکته مثبت|موقت/.test(text)) return `• ⚠️ ${text}`;
      if (/Death Cross|ضعیف‌تر|اصلاح بیشتر|بازگشت قدرتمند|نزولی‌تر/.test(text)) {
        return `• ❌ ${text}`;
      }
      return `• ✅ ${text}`;
    })
    .join("\n");

  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines((longConfirm.how || []).slice(0, 3), "•");
  const shortHow = joinLines((shortConfirm.how || []).slice(0, 3), "•");

  const bearProb = Number(analysis.bearish_scenario_probability || 0);
  const bullProb = Number(analysis.bullish_scenario_probability || 0);
  const bearFirst = bearProb >= bullProb;

  const bearBlock = [
    `## 🔴 سناریوی ${bearFirst ? "اول (محتمل‌تر)" : "دوم"}`,
    "",
    `احتمال: ${bearProb}%`,
    "",
    analysis.bearish_scenario || "نامشخص",
  ].join("\n");

  const bullBlock = [
    `## 🟢 سناریوی ${bearFirst ? "دوم" : "اول (محتمل‌تر)"}`,
    "",
    `احتمال: ${bullProb}%`,
    "",
    analysis.bullish_scenario || "نامشخص",
  ].join("\n");

  const scenarioBlocks = bearFirst
    ? `${bearBlock}\n\n---\n\n${bullBlock}`
    : `${bullBlock}\n\n---\n\n${bearBlock}`;

  const mainSupport = analysis.key_support?.[0] || "حمایت کلیدی";
  const mainResistance = analysis.key_resistance?.[0] || "مقاومت کلیدی";
  const correctionProb =
    analysis.correction_probability || analysis.bearish_probability || bearProb || 0;
  const bounceProb =
    analysis.breakout_probability_24_48h || analysis.bullish_probability || bullProb || 0;

  const parts = [
    `تاریخ: ${formatDateLine()}`,
    "",
    "---",
    "",
    "# خلاصه بازار",
    "",
    analysis.market_summary || analysis.summary || "نامشخص",
    analysis.market_battle_points?.length
      ? `\nدر حال حاضر مهم‌ترین نبرد بازار روی محدوده ${analysis.market_battle_points[0]} در جریان است.`
      : null,
    "",
    "---",
    "",
    "# تحلیل فاندامنتال",
    "",
    fundamentals || "مورد خاصی ثبت نشده است.",
    "",
    "---",
    "",
    "# تحلیل تکنیکال",
    "",
    "## روند بلندمدت",
    "",
    analysis.technical_long_term?.text || "نامشخص",
    "",
    longPositives ? `نشانه‌های مثبت:\n\n${longPositives}` : null,
    longWarnings ? `نشانه‌های مهم:\n\n${longWarnings}` : null,
    "",
    "---",
    "",
    "# روند کوتاه‌مدت",
    "",
    analysis.technical_short_term?.text || "نامشخص",
    "",
    shortPoints ? `### وضعیت اندیکاتورها\n\n${shortPoints}` : null,
    "",
    "---",
    "",
    "# سطوح مهم بازار",
    "",
    "## 🟢 حمایت‌ها",
    "",
    supports || "نامشخص",
    "",
    "## 🔴 مقاومت‌ها",
    "",
    resistances || "نامشخص",
    "",
    "---",
    "",
    "# سناریوهای احتمالی",
    "",
    scenarioBlocks,
    "",
    "---",
    "",
    "# ارزیابی اندیکاتورها",
    "",
    indicators || "نامشخص",
    "",
    comparison
      ? ["---", "", "# مقایسه با تحلیل قبلی", "", comparison, ""].join("\n")
      : null,
    "---",
    "",
    "# جمع‌بندی نهایی",
    "",
    analysis.final_verdict || analysis.summary || "نامشخص",
    "",
    "## 🎯 نتیجه نهایی",
    "",
    `• روند بلندمدت: ${analysis.long_term_trend || "نامشخص"}`,
    `• روند کوتاه‌مدت: ${analysis.short_term_trend || "نامشخص"} با احتمال ${analysis.confidence || bearProb || 0}%`,
    `• احتمال شکست حمایت ${mainSupport}: ${correctionProb}%`,
    `• احتمال پولبک تا ${mainResistance}: ${bounceProb}%`,
    "",
    "### پیشنهاد معاملاتی",
    "",
    analysis.trading_suggestion || analysis.short_term_strategy || "نامشخص",
    "",
    "---",
    "",
    "# چطور ورود تأیید می‌شود؟",
    "",
    "## 🟢 لانگ",
    "",
    `کجا: ${longConfirm.zone || "نامشخص"}`,
    longHow ? `\nچطور:\n${longHow}` : null,
    longConfirm.invalidation ? `\nباطل اگر: ${longConfirm.invalidation}` : null,
    "",
    "## 🔴 شورت",
    "",
    `کجا: ${shortConfirm.zone || "نامشخص"}`,
    shortHow ? `\nچطور:\n${shortHow}` : null,
    shortConfirm.invalidation ? `\nباطل اگر: ${shortConfirm.invalidation}` : null,
    "",
    "⚠️ سیگنال قطعی خرید/فروش نیست؛ راهنمای رصد و مدیریت ریسک است.",
  ];

  return parts.filter((line) => line != null).join("\n");
}

function formatCardCaption(analysis) {
  return [
    `${analysis.pair_label || analysis.symbol} | ${analysis.bias || "خنثی"} | ${analysis.confidence || 0}%`,
    `محدوده: ${analysis.current_range || "نامشخص"}`,
  ].join("\n");
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
