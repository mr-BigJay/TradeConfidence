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

function clip(text, max) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
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
 * Medium-length practical Persian analysis for normal users.
 */
function formatDeepAnalysisMessage(analysis) {
  const supports = (analysis.key_support || []).slice(0, 3).join(" | ") || "نامشخص";
  const resistances = (analysis.key_resistance || []).slice(0, 3).join(" | ") || "نامشخص";
  const battlePoints = joinLines((analysis.market_battle_points || []).slice(0, 3), "•");

  const fundamentals = (analysis.fundamentals || [])
    .slice(0, 3)
    .map((item) => `${toneEmoji(item.tone)} ${item.title}\n${clip(item.text, 180)}`)
    .join("\n\n");

  const longTech = clip(analysis.technical_long_term?.text || "", 220);
  const shortTech = clip(analysis.technical_short_term?.text || "", 220);
  const longWarnings = joinLines((analysis.technical_long_term?.warnings || []).slice(0, 3), "•");
  const shortPoints = joinLines((analysis.technical_short_term?.points || []).slice(0, 3), "•");

  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines((longConfirm.how || []).slice(0, 3), "•");
  const shortHow = joinLines((shortConfirm.how || []).slice(0, 3), "•");

  const whatToDo = clip(
    analysis.trading_suggestion || analysis.short_term_strategy || analysis.final_verdict || "",
    320,
  );

  const verdict = clip(analysis.final_verdict || analysis.summary || "", 320);

  return [
    `${analysis.pair_label || analysis.symbol} — تحلیل وضعیت بازار`,
    `بایاس: ${analysis.bias || "خنثی"} | اطمینان: ${analysis.confidence || 0}% | قیمت: ${analysis.current_price || "-"}`,
    "",
    "وضعیت فعلی",
    clip(analysis.market_summary || analysis.summary || "نامشخص", 520),
    battlePoints ? `\nنکات کلیدی:\n${battlePoints}` : "",
    "",
    fundamentals ? `عوامل مهم:\n${fundamentals}\n` : "",
    "نگاه تکنیکال",
    longTech
      ? `بلندمدت (${analysis.technical_long_term?.bias || analysis.long_term_trend || "نامشخص"}):\n${longTech}`
      : "",
    longWarnings ? `${longWarnings}` : "",
    shortTech
      ? `\nکوتاه‌مدت (${analysis.technical_short_term?.bias || analysis.short_term_trend || "نامشخص"}):\n${shortTech}`
      : "",
    shortPoints ? `${shortPoints}` : "",
    "",
    "سطوح مهم",
    `حمایت: ${supports}`,
    `مقاومت: ${resistances}`,
    analysis.current_range ? `محدوده: ${analysis.current_range}` : "",
    "",
    "الان چه کار کنی؟",
    whatToDo || "عجله نکن و همین سطوح را رصد کن.",
    "",
    "سناریوها",
    `🔴 نزولی (${analysis.bearish_scenario_probability || 0}%):\n${clip(analysis.bearish_scenario, 220)}`,
    analysis.bearish_targets?.length ? `اهداف: ${analysis.bearish_targets.join(" | ")}` : "",
    "",
    `🟢 صعودی (${analysis.bullish_scenario_probability || 0}%):\n${clip(analysis.bullish_scenario, 220)}`,
    analysis.bullish_targets?.length ? `اهداف: ${analysis.bullish_targets.join(" | ")}` : "",
    "",
    "چطور ورود تأیید می‌شود؟",
    "",
    "🟢 لانگ",
    `کجا: ${clip(longConfirm.zone, 140)}`,
    longHow ? `چطور:\n${longHow}` : "",
    longConfirm.invalidation ? `باطل اگر: ${clip(longConfirm.invalidation, 120)}` : "",
    "",
    "🔴 شورت",
    `کجا: ${clip(shortConfirm.zone, 140)}`,
    shortHow ? `چطور:\n${shortHow}` : "",
    shortConfirm.invalidation ? `باطل اگر: ${clip(shortConfirm.invalidation, 120)}` : "",
    "",
    "جمع‌بندی",
    verdict || "نامشخص",
    "",
    "⚠️ سیگنال قطعی خرید/فروش نیست؛ راهنمای رصد سناریو است.",
  ]
    .filter((line) => line !== "")
    .join("\n");
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

  for (const chunk of splitTelegramText(report)) {
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
