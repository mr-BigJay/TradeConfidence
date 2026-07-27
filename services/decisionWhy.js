/**
 * Two-line Persian explanation of why today's setup was chosen.
 */

function clip(text, max = 180) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

function buildDecisionWhy(plan = {}, engineScore = {}) {
  const setup = engineScore.chart_setup || {};
  const validation = engineScore.validation || {};
  const components = engineScore.components || {};
  const direction = String(plan.direction || "RANGE").toUpperCase();
  const bias = plan.bias || "Neutral";
  const confidence = plan.confidence ?? engineScore.confidence ?? 0;
  const entry = plan.entry || "-";
  const sl = plan.stop_loss || "-";
  const tp1 = plan.tp1 || "-";
  const marketOk = setup.market_confirmation ? "بازار تأیید" : "بازار ناقص";
  const techOk = setup.technical_confirmation ? "تکنیکال تأیید" : "تکنیکال ناقص";
  const tradeYes = Boolean(plan.trade_allowed || setup.trade_allowed);
  const validationStatus = plan.coinex_validation_status || validation.status || "Partially Confirmed";

  let line1;
  let line2;

  if (tradeYes && direction === "LONG") {
    line1 = `این پوزیشن LONG انتخاب شد چون ${marketOk} و ${techOk} با بایاس صعودی هم‌راستا بودند (Trade=YES، اطمینان ${confidence}%).`;
    line2 = `ورود روی واکنش حمایت ${entry}، حد ضرر ${sl} و هدف اول ${tp1}؛ اعتبارسنجی روایت: ${validationStatus}.`;
  } else if (tradeYes && direction === "SHORT") {
    line1 = `این پوزیشن SHORT انتخاب شد چون ${marketOk} و ${techOk} با بایاس نزولی هم‌راستا بودند (Trade=YES، اطمینان ${confidence}%).`;
    line2 = `ورود روی واکنش مقاومت ${entry}، حد ضرر ${sl} و هدف اول ${tp1}؛ اعتبارسنجی روایت: ${validationStatus}.`;
  } else if (/bear/i.test(String(bias))) {
    line1 =
      "معامله جهتی قفل نشد؛ به‌خاطر بایاس نزولی فقط سطوح رنج با سبک فروشِ واکنش به مقاومت برای رصد منتشر شد.";
    line2 = `دلیل: هنوز هر سه تأیید Market/Technical/Risk کامل نیست (${marketOk}، ${techOk}). ورود پیشنهادی ${entry} با SL ${sl} فقط برای مدیریت ریسک رنج است.`;
  } else if (/bull/i.test(String(bias))) {
    line1 =
      "معامله جهتی قفل نشد؛ به‌خاطر بایاس صعودی فقط سطوح رنج با سبک خریدِ واکنش به حمایت برای رصد منتشر شد.";
    line2 = `دلیل: هنوز هر سه تأیید Market/Technical/Risk کامل نیست (${marketOk}، ${techOk}). ورود پیشنهادی ${entry} با SL ${sl} فقط برای مدیریت ریسک رنج است.`;
  } else {
    line1 =
      "بازار خنثی/رنج تشخیص داده شد و پوزیشن LONG/SHORT صادر نشد چون تأیید کامل معامله وجود نداشت.";
    line2 = `سطوح ${entry} تا ${tp1} فقط نقشهٔ رصد روز هستند؛ Score فعلی حدود ${confidence}% و وضعیت روایت ${validationStatus} است.`;
  }

  // Optional tiny score hint if useful and short.
  if (components && (components.futures !== undefined || components.technical !== undefined)) {
    const hint = `Futures ${components.futures ?? "-"} / Tech ${components.technical ?? "-"}`;
    if (line2.length < 140) {
      line2 = `${line2} (${hint})`;
    }
  }

  return [clip(line1, 220), clip(line2, 220)];
}

function formatDecisionWhyBlock(plan, engineScore) {
  const [line1, line2] = buildDecisionWhy(plan, engineScore);
  return ["دلیل تصمیم:", line1, line2].join("\n");
}

module.exports = {
  buildDecisionWhy,
  formatDecisionWhyBlock,
};
