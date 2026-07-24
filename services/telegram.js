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

function uniqueChecklist(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = String(item.name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 6) break;
  }
  return out;
}

function joinLines(items, bullet = "•") {
  return (items || []).map((item) => `${bullet} ${item}`).join("\n");
}

/**
 * Compact Telegram report:
 * header → checklist → conflict → scores → verdict
 * Avoids long fundamental/technical essays that make the feed noisy.
 */
function formatDeepAnalysisMessage(analysis) {
  const checklist = uniqueChecklist(analysis.derivatives_checklist)
    .map((item) => `${toneEmoji(item.tone)} ${item.name}: ${item.value} → ${item.result}`)
    .join("\n");

  const battlePoints = joinLines((analysis.market_battle_points || []).slice(0, 4), "•");
  const supports = (analysis.key_support || []).slice(0, 3).join(" | ") || "نامشخص";
  const resistances = (analysis.key_resistance || []).slice(0, 3).join(" | ") || "نامشخص";

  const summary =
    analysis.market_summary ||
    analysis.summary ||
    analysis.final_verdict ||
    "نامشخص";

  const verdict = analysis.final_verdict || analysis.summary || "نامشخص";
  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = joinLines(longConfirm.how || [], "•");
  const shortHow = joinLines(shortConfirm.how || [], "•");

  const scoreLine =
    analysis.long_score !== null && analysis.long_score !== undefined
      ? `لانگ ${analysis.long_score}/10  |  شورت ${analysis.short_score ?? "-"}/10`
      : null;

  return [
    `${analysis.pair_label || analysis.symbol} — وضعیت بازار`,
    `بایاس: ${analysis.bias || "خنثی"} | اطمینان: ${analysis.confidence || 0}% | قیمت: ${analysis.current_price || "-"}`,
    "",
    "چک‌لیست ۱ ساعته",
    checklist || "داده Bitunix موجود نبود",
    scoreLine ? `\n${scoreLine}` : "",
    "",
    "توضیح وضعیت",
    summary,
    battlePoints ? `\nتضاد/نبرد اصلی:\n${battlePoints}` : "",
    "",
    "سطوح",
    `حمایت: ${supports}`,
    `مقاومت: ${resistances}`,
    analysis.current_range ? `محدوده: ${analysis.current_range}` : "",
    "",
    "سناریو",
    `🟢 صعودی ${analysis.bullish_scenario_probability || 0}% — ${analysis.bullish_scenario || "نامشخص"}`,
    Number(analysis.neutral_scenario_probability) > 0
      ? `🟠 خنثی ${analysis.neutral_scenario_probability}% — ${analysis.neutral_scenario || "نامشخص"}`
      : "",
    `🔴 نزولی ${analysis.bearish_scenario_probability || 0}% — ${analysis.bearish_scenario || "نامشخص"}`,
    "",
    "تأییدیه سناریوی لانگ",
    `کجا: ${longConfirm.zone || "نامشخص"}`,
    longHow ? `چطور:\n${longHow}` : "",
    longConfirm.invalidation ? `باطل‌کننده: ${longConfirm.invalidation}` : "",
    "",
    "تأییدیه سناریوی شورت",
    `کجا: ${shortConfirm.zone || "نامشخص"}`,
    shortHow ? `چطور:\n${shortHow}` : "",
    shortConfirm.invalidation ? `باطل‌کننده: ${shortConfirm.invalidation}` : "",
    "",
    "جمع‌بندی",
    verdict,
    "",
    "⚠️ دستور ورود نیست؛ فقط شرایط تأیید سناریو برای مدیریت ریسک.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatCardCaption(analysis) {
  const score =
    analysis.long_score !== null && analysis.long_score !== undefined
      ? ` | L ${analysis.long_score}/S ${analysis.short_score ?? "-"}`
      : "";

  return [
    `${analysis.pair_label || analysis.symbol} — کارت وضعیت`,
    `بایاس: ${analysis.bias || "خنثی"} | ${analysis.confidence || 0}%${score}`,
    `محدوده: ${analysis.current_range || "نامشخص"}`,
    "",
    "گزارش کوتاه در پیام بعد.",
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
    let cut = remaining.lastIndexOf("\n\n", maxLength);
    if (cut < maxLength * 0.5) {
      cut = remaining.lastIndexOf("\n", maxLength);
    }
    if (cut < maxLength * 0.5) {
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
