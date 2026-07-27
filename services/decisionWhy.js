/**
 * Short Persian day-outlook lines for Telegram / chart caption.
 * Keep captions tight: next candle color + likely price zone. No repetition.
 */

function clip(text, max = 160) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

function dayFaFrom(plan = {}, engineScore = {}) {
  const outlook = engineScore.day_outlook || {};
  return (
    plan.day_outlook_fa ||
    outlook.expected_day_candle_fa ||
    (plan.day_outlook === "green" ? "سبز" : plan.day_outlook === "red" ? "قرمز" : "خنثی")
  );
}

function dayConfidence(plan = {}, engineScore = {}) {
  return (
    plan.day_outlook_confidence ??
    engineScore.day_outlook?.confidence ??
    plan.confidence ??
    0
  );
}

function closedSnippet(plan = {}, engineScore = {}) {
  const closed = plan.closed_daily_candle || engineScore.day_outlook?.closed_candle;
  if (!closed?.color_fa) return null;
  if (closed.open != null && closed.close != null) {
    return `دیروز ${closed.color_fa} (${closed.open}→${closed.close})`;
  }
  return `دیروز ${closed.color_fa}`;
}

/**
 * Likely price zone for the day (TP cluster or entry watch zone).
 */
function likelyZone(plan = {}) {
  const day = String(plan.day_outlook_fa || plan.day_outlook || "").toLowerCase();
  const green = day === "سبز" || day === "green";
  const red = day === "قرمز" || day === "red";

  if (green && plan.tp1 && plan.tp2) return `${plan.tp1} تا ${plan.tp2}`;
  if (red && plan.tp1 && plan.tp2) return `${plan.tp1} تا ${plan.tp2}`;
  if (plan.entry) return String(plan.entry);
  if (plan.tp1) return String(plan.tp1);
  return null;
}

function buildDecisionWhy(plan = {}, engineScore = {}) {
  const setup = engineScore.chart_setup || {};
  const dayFa = dayFaFrom(plan, engineScore);
  const conf = dayConfidence(plan, engineScore);
  const zone = likelyZone(plan);
  const tradeYes = Boolean(plan.trade_allowed || setup.trade_allowed);
  const direction = String(plan.direction || "RANGE").toUpperCase();

  let line1;
  if (dayFa === "خنثی") {
    line1 = `طبق برآورد، کندل روز پیش‌رو جهت واضحی ندارد (اطمینان ${conf}%).`;
  } else {
    line1 = `طبق برآورد، کندل روز پیش‌رو احتمالاً ${dayFa} خواهد بود (اطمینان ${conf}%).`;
  }

  let line2;
  if (zone) {
    line2 = `احتمال رسیدن قیمت به ناحیه ${zone}.`;
  } else {
    line2 = "ناحیه هدف مشخصی از سطوح موجود استخراج نشد.";
  }

  if (tradeYes && (direction === "LONG" || direction === "SHORT")) {
    line2 = `${line2} ستاپ ${direction}: ورود ${plan.entry || "-"} / حدضرر ${plan.stop_loss || "-"}.`;
  } else {
    line2 = `${line2} فعلاً فقط رصد — سیگنال معامله جهتی نیست.`;
  }

  return [clip(line1, 180), clip(line2, 180)];
}

function formatDecisionWhyBlock(plan, engineScore) {
  const [line1, line2] = buildDecisionWhy(plan, engineScore);
  return [line1, line2].join("\n");
}

/**
 * Compact caption under the daily setup chart image.
 */
function formatMorningCaption(plan = {}, meta = {}) {
  const engineScore = meta.engineScore || {};
  const dayFa = dayFaFrom(plan, engineScore);
  const conf = dayConfidence(plan, engineScore);
  const zone = likelyZone(plan);
  const closed = closedSnippet(plan, engineScore);
  const replacing = meta.replacing ? "به‌روزرسانی ستاپ امروز" : null;

  const estimate =
    dayFa === "خنثی"
      ? `طبق برآورد: کندل روز پیش‌رو خنثی/رنج است (${conf}%).`
      : `طبق برآورد: کندل روز پیش‌رو احتمالاً ${dayFa} خواهد بود (${conf}%).`;

  const zoneLine = zone ? `احتمال رسیدن قیمت به ناحیه ${zone}.` : null;
  const closedLine = closed || null;
  const watch =
    plan.trade_allowed === false || plan.direction === "RANGE"
      ? "فقط رصد — سیگنال معامله نیست."
      : `ستاپ ${plan.direction}: ورود ${plan.entry || "-"} | حدضرر ${plan.stop_loss || "-"}.`;

  return [replacing, meta.iranDate ? `BTC روزانه | ${meta.iranDate}` : "BTC روزانه", estimate, zoneLine, closedLine, watch]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

module.exports = {
  buildDecisionWhy,
  formatDecisionWhyBlock,
  formatMorningCaption,
  likelyZone,
  dayFaFrom,
};
