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
  const outlook = engineScore.day_outlook || {};
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
  const dayFa =
    plan.day_outlook_fa ||
    outlook.expected_day_candle_fa ||
    (plan.day_outlook === "green" ? "سبز" : plan.day_outlook === "red" ? "قرمز" : "خنثی");
  const closedFa =
    plan.closed_daily_candle?.color_fa || outlook.closed_candle?.color_fa || "-";

  let line1;
  let line2;

  if (tradeYes && direction === "LONG") {
    line1 = `سناریوی روز: کندل احتمالاً ${dayFa}. پوزیشن LONG چون ${marketOk} و ${techOk} هم‌راستا بودند (اطمینان ${confidence}%).`;
    line2 = `کندل بسته‌شده ${closedFa} بود؛ ورود ${entry} / SL ${sl} / TP1 ${tp1}؛ روایت: ${validationStatus}.`;
  } else if (tradeYes && direction === "SHORT") {
    line1 = `سناریوی روز: کندل احتمالاً ${dayFa}. پوزیشن SHORT چون ${marketOk} و ${techOk} هم‌راستا بودند (اطمینان ${confidence}%).`;
    line2 = `کندل بسته‌شده ${closedFa} بود؛ ورود ${entry} / SL ${sl} / TP1 ${tp1}؛ روایت: ${validationStatus}.`;
  } else if (/bear/i.test(String(bias)) || dayFa === "قرمز") {
    line1 = `سناریوی روز: کندل احتمالاً ${dayFa}. معامله جهتی قفل نشد؛ فقط سطوح رصد (Monitoring Only) منتشر شد.`;
    line2 = `دلیل: تأیید کامل Market/Technical/Risk نیست (${marketOk}، ${techOk}). کندل بسته‌شده ${closedFa}؛ سطوح ${entry} فقط برای رصد است.`;
  } else if (/bull/i.test(String(bias)) || dayFa === "سبز") {
    line1 = `سناریوی روز: کندل احتمالاً ${dayFa}. معامله جهتی قفل نشد؛ فقط سطوح رصد (Monitoring Only) منتشر شد.`;
    line2 = `دلیل: تأیید کامل Market/Technical/Risk نیست (${marketOk}، ${techOk}). کندل بسته‌شده ${closedFa}؛ سطوح ${entry} فقط برای رصد است.`;
  } else {
    line1 = `سناریوی روز خنثی است و پوزیشن LONG/SHORT صادر نشد (کندل بسته‌شده: ${closedFa}).`;
    line2 = `سطوح ${entry} تا ${tp1} فقط نقشهٔ رصد هستند؛ Score حدود ${confidence}% و روایت ${validationStatus}.`;
  }

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
