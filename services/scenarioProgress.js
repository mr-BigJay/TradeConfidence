/**
 * Evaluate whether the 03:30 morning day-candle scenario is tracking so far.
 */

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function midFromEntry(entry) {
  if (entry == null) return null;
  const text = String(entry);
  if (text.includes("-")) {
    const [a, b] = text.split("-").map((part) => toNumber(part));
    if (a != null && b != null) return (a + b) / 2;
  }
  return toNumber(text);
}

function colorFa(color) {
  if (color === "green") return "سبز";
  if (color === "red") return "قرمز";
  return "خنثی";
}

function currentDayPath(dayOpen, price) {
  if (dayOpen == null || price == null) return "unknown";
  if (price > dayOpen * 1.0005) return "green";
  if (price < dayOpen * 0.9995) return "red";
  return "neutral";
}

/**
 * @param {object} input
 * @param {object} input.morningPlan - locked daily setup / plan fields
 * @param {object} input.marketBundle
 * @param {object} [input.engineScore]
 */
function evaluateScenarioProgress({ morningPlan = {}, marketBundle = {}, engineScore = {} } = {}) {
  const setup = morningPlan.setup || morningPlan;
  const predicted =
    setup.day_outlook ||
    setup.day_outlook_full?.expected_day_candle ||
    morningPlan.day_outlook ||
    engineScore.day_outlook?.expected_day_candle ||
    "neutral";
  const predictedFa =
    setup.day_outlook_fa ||
    setup.day_outlook_full?.expected_day_candle_fa ||
    colorFa(predicted);

  const closed = setup.closed_daily_candle || setup.day_outlook_full?.closed_candle || null;

  // Current forming daily candle: last bar in 1D tail while still open.
  const tail = marketBundle.chart?.daily_candles_tail || [];
  const lastDaily = tail[tail.length - 1] || null;
  const dayOpen =
    toNumber(lastDaily?.open) ||
    toNumber(closed?.close) ||
    toNumber(morningPlan.current_price) ||
    toNumber(setup.current_price);

  const price =
    toNumber(marketBundle.futures?.price) ||
    toNumber(marketBundle.chart?.ltf?.price) ||
    toNumber(marketBundle.chart?.htf?.price);

  const path = currentDayPath(dayOpen, price);
  const pathFa = colorFa(path);

  const entryMid = midFromEntry(setup.entry || morningPlan.entry);
  const tp1 = toNumber(setup.tp1 || morningPlan.tp1);
  const tp2 = toNumber(setup.tp2 || morningPlan.tp2);
  const sl = toNumber(setup.stop_loss || morningPlan.stop_loss);

  let levelNote = null;
  if (price != null && tp1 != null && predicted === "green" && price >= tp1) {
    levelNote = `قیمت به/بالای TP1 (${tp1}) رسیده.`;
  } else if (price != null && tp1 != null && predicted === "red" && price <= tp1) {
    levelNote = `قیمت به/زیر TP1 نزولی (${tp1}) رسیده.`;
  } else if (price != null && sl != null && predicted === "green" && price <= sl) {
    levelNote = `حدضرر صعودی (${sl}) لمس/شکسته شده.`;
  } else if (price != null && sl != null && predicted === "red" && price >= sl) {
    levelNote = `حدضرر نزولی (${sl}) لمس/شکسته شده.`;
  } else if (price != null && entryMid != null) {
    const distPct = ((price - entryMid) / entryMid) * 100;
    levelNote = `فاصله از ناحیه ورود حدود ${distPct >= 0 ? "+" : ""}${distPct.toFixed(2)}٪.`;
  }

  let status = "unknown";
  let statusFa = "نامشخص";
  let verdictFa = "داده کافی برای قضاوت نیست.";

  if (predicted === "neutral") {
    status = "neutral_plan";
    statusFa = "سناریوی صبح خنثی بود";
    verdictFa =
      path === "neutral"
        ? "تا اینجا بازار بدون جهت واضح مانده."
        : `تا اینجا مسیر کندل موقتاً ${pathFa} است؛ صبح جهت قطعی اعلام نشده بود.`;
  } else if (path === "unknown") {
    status = "unknown";
    statusFa = "نامشخص";
  } else if (path === predicted) {
    status = "on_track";
    statusFa = "در مسیر تحقق";
    verdictFa = `سناریوی صبح (${predictedFa}) تا اینجا هم‌راستا است؛ کندل روز فعلاً ${pathFa} پیش می‌رود.`;
  } else if (path === "neutral") {
    status = "pending";
    statusFa = "هنوز مبهم";
    verdictFa = `سناریوی صبح ${predictedFa} بود؛ قیمت هنوز نزدیک باز شدن روز است و جهت قطعی نشده.`;
  } else {
    status = "off_track";
    statusFa = "خارج از سناریو";
    verdictFa = `سناریوی صبح ${predictedFa} بود، ولی تا اینجا مسیر کندل ${pathFa} است.`;
  }

  const biasNow = engineScore.bias || marketBundle.chart?.htf?.indicators?.trend || "Neutral";
  const funding = marketBundle.futures?.fundingRatePercent;
  const oi = marketBundle.futures?.openInterest?.trend;

  return {
    predicted,
    predicted_fa: predictedFa,
    current_path: path,
    current_path_fa: pathFa,
    status,
    status_fa: statusFa,
    verdict_fa: verdictFa,
    day_open: dayOpen,
    price,
    move_pct:
      dayOpen && price != null ? Number((((price - dayOpen) / dayOpen) * 100).toFixed(3)) : null,
    level_note: levelNote,
    morning_bias: setup.bias || morningPlan.bias || null,
    morning_direction: setup.direction || morningPlan.direction || null,
    bias_now: biasNow,
    funding,
    oi_trend: oi,
    entry: setup.entry || morningPlan.entry || null,
    tp1,
    tp2,
    stop_loss: sl,
  };
}

function formatScenarioCheckMessage(progress, meta = {}) {
  const move =
    progress.move_pct == null
      ? "-"
      : `${progress.move_pct >= 0 ? "+" : ""}${progress.move_pct}%`;

  return [
    meta.replacing ? null : null,
    "BTC گزارش ۸ساعته",
    meta.iranDate ? `تاریخ: ${meta.iranDate}` : null,
    meta.clock ? `ساعت: ${meta.clock}` : null,
    "",
    `سناریوی ۰۳:۳۰: کندل ${progress.predicted_fa}`,
    `وضعیت تا الآن: ${progress.status_fa}`,
    progress.verdict_fa,
    "",
    `قیمت: ${progress.price ?? "-"} | بازشدن روز: ${progress.day_open ?? "-"} | تغییر: ${move}`,
    `مسیر کندل فعلی: ${progress.current_path_fa}`,
    progress.level_note || null,
    "",
    `بازار الآن: ${progress.bias_now || "-"} | Funding: ${progress.funding ?? "-"} | OI: ${progress.oi_trend || "-"}`,
    progress.entry ? `ناحیه صبح: ورود ${progress.entry} | TP1 ${progress.tp1 ?? "-"} | SL ${progress.stop_loss ?? "-"}` : null,
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

module.exports = {
  evaluateScenarioProgress,
  formatScenarioCheckMessage,
  currentDayPath,
  colorFa,
};
