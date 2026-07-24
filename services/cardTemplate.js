function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toneClass(tone) {
  if (tone === "bullish") return "tone-bull";
  if (tone === "bearish") return "tone-bear";
  return "tone-neutral";
}

function formatNow() {
  const now = new Date();
  const date = now.toLocaleDateString("fa-IR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return { date, time: `${time} (UTC)` };
}

function parseLevel(value) {
  const numeric = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPrice(value) {
  const numeric = parseLevel(value);
  if (numeric === null) return String(value ?? "");
  return numeric.toLocaleString("en-US");
}

function buildCandleSvg(candles = [], analysis = {}) {
  if (!candles.length) {
    return `<div class="chart-empty">نمودار قیمت در دسترس نیست</div>`;
  }

  const width = 560;
  const height = 300;
  const padX = 28;
  const padY = 28;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const levelValues = [...(analysis.key_resistance || []), ...(analysis.key_support || [])]
    .map(parseLevel)
    .filter((value) => value !== null);

  const max = Math.max(...highs, ...(levelValues.length ? levelValues : [0]));
  const min = Math.min(...lows, ...(levelValues.length ? levelValues : highs));
  const span = Math.max(max - min, 1);
  const step = (width - padX * 2) / Math.max(candles.length - 1, 1);
  const yFor = (price) => padY + ((max - price) / span) * (height - padY * 2);

  const grid = [0.15, 0.35, 0.55, 0.75]
    .map((ratio) => {
      const y = padY + ratio * (height - padY * 2);
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(100,116,139,0.18)" stroke-width="1" />`;
    })
    .join("");

  const body = candles
    .map((candle, index) => {
      const x = padX + index * step;
      const yHigh = yFor(candle.high);
      const yLow = yFor(candle.low);
      const yOpen = yFor(candle.open);
      const yClose = yFor(candle.close);
      const bullish = candle.close >= candle.open;
      const color = bullish ? "#22c55e" : "#ef4444";
      const top = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 2.8);
      return `
        <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.7" />
        <rect x="${x - 3.8}" y="${top}" width="7.6" height="${bodyHeight}" fill="${color}" rx="1.5" />
      `;
    })
    .join("");

  const resistanceLines = (analysis.key_resistance || [])
    .slice(0, 2)
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `
        <line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#ef4444" stroke-dasharray="7 5" stroke-width="1.5" opacity="0.95" />
        <text x="${width - padX - 2}" y="${y - 6}" fill="#fca5a5" font-size="11" text-anchor="end" font-family="Vazirmatn, sans-serif">${escapeHtml(formatPrice(level))}</text>
      `;
    })
    .join("");

  const supportLines = (analysis.key_support || [])
    .slice(0, 2)
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `
        <line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#22c55e" stroke-dasharray="7 5" stroke-width="1.5" opacity="0.95" />
        <text x="${width - padX - 2}" y="${y - 6}" fill="#86efac" font-size="11" text-anchor="end" font-family="Vazirmatn, sans-serif">${escapeHtml(formatPrice(level))}</text>
      `;
    })
    .join("");

  const last = candles[candles.length - 1];
  const lastX = padX + (candles.length - 1) * step;
  const lastY = yFor(last.close);
  const priceLabel = formatPrice(analysis.current_price || last.close);

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="300" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chartBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#101b31" />
          <stop offset="100%" stop-color="#0a1220" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#chartBg)" rx="14" />
      ${grid}
      ${resistanceLines}
      ${supportLines}
      ${body}
      <line x1="${lastX}" y1="${padY}" x2="${lastX}" y2="${height - padY}" stroke="rgba(226,232,240,0.25)" stroke-dasharray="3 4" />
      <circle cx="${lastX}" cy="${lastY}" r="5" fill="#f8fafc" stroke="#38bdf8" stroke-width="2" />
      <rect x="${Math.min(lastX + 10, width - 108)}" y="${Math.max(lastY - 14, 10)}" rx="8" width="92" height="24" fill="#0f172a" stroke="#475569" />
      <text x="${Math.min(lastX + 56, width - 62)}" y="${Math.max(lastY + 2, 26)}" fill="#f8fafc" font-size="12" text-anchor="middle" font-family="Vazirmatn, sans-serif" font-weight="700">${escapeHtml(priceLabel)}</text>
    </svg>
  `;
}

function renderLevels(items, kind) {
  if (!items?.length) {
    return `<div class="level-row muted">نامشخص</div>`;
  }

  const labels =
    kind === "resist"
      ? ["مقاومت اصلی", "مقاومت بعدی (بریک‌اوت)", "هدف بالاتر"]
      : ["حمایت نزدیک", "حمایت میانی", "حمایت اصلی"];

  return items
    .slice(0, 3)
    .map(
      (item, index) => `
      <div class="level-row ${kind}">
        <span class="level-label">${escapeHtml(labels[index] || "سطح")}</span>
        <span class="level-value">${escapeHtml(formatPrice(item))}</span>
      </div>`,
    )
    .join("");
}

function buildAnalysisCardHtml(analysis, candles = []) {
  const { date, time } = formatNow();
  const confidence = Number(analysis.confidence) || 0;
  const circumference = 2 * Math.PI * 30;
  const offset = circumference - (confidence / 100) * circumference;

  const insights = (analysis.insights || []).slice(0, 4);
  while (insights.length < 4) {
    insights.push({
      title: analysis.summary ? "خلاصه بازار" : "نکته",
      text: analysis.summary || analysis.market_summary || "در حال آماده‌سازی",
      tone: "neutral",
    });
  }

  const insightHtml = insights
    .map(
      (item) => `
      <div class="insight ${toneClass(item.tone)}">
        <div class="insight-title">${escapeHtml(item.title)}</div>
        <div class="insight-text">${escapeHtml(item.text)}</div>
      </div>`,
    )
    .join("");

  const indicators = (analysis.indicators || []).slice(0, 7);
  const indicatorHtml = indicators.length
    ? indicators
        .map(
          (item) => `
        <div class="indicator ${toneClass(item.tone)}">
          <div class="indicator-name">${escapeHtml(item.name)}</div>
          <div class="indicator-status">${escapeHtml(item.status)}</div>
        </div>`,
        )
        .join("")
    : `<div class="indicator tone-neutral"><div class="indicator-name">وضعیت</div><div class="indicator-status">${escapeHtml(analysis.bias)}</div></div>`;

  const showNeutral = Number(analysis.neutral_scenario_probability) > 0;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #020617;
      color: #e8eefc;
      font-family: "Vazirmatn", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 1600px;
      padding: 24px 24px 20px;
      background:
        radial-gradient(circle at 10% 0%, rgba(56,189,248,.12), transparent 26%),
        radial-gradient(circle at 90% 0%, rgba(34,197,94,.10), transparent 24%),
        linear-gradient(180deg, #07111f 0%, #050b16 45%, #020617 100%);
    }

    /* ===== HEADER ===== */
    .header {
      display: grid;
      grid-template-columns: 1.25fr 1fr 1.15fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .panel {
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.14);
      border-radius: 16px;
      padding: 16px 18px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btc-logo {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 28%, #ffd48a, #f7931a 60%, #c2410c);
      display: grid;
      place-items: center;
      color: #111;
      font-size: 22px;
      font-weight: 800;
      box-shadow: 0 0 16px rgba(247,147,26,.35);
    }
    .pair-name {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -0.4px;
    }
    .pair-sub {
      margin-top: 4px;
      color: #93c5fd;
      font-size: 14px;
      font-weight: 600;
    }
    .field-label {
      color: #94a3b8;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .bias-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .bias-value {
      font-size: 32px;
      font-weight: 800;
      color: #fbbf24;
    }
    .bias-chip {
      min-width: 52px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid rgba(245,158,11,.35);
      background: rgba(245,158,11,.12);
      color: #f59e0b;
      display: grid;
      place-items: center;
      font-size: 20px;
      font-weight: 700;
    }
    .confidence-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .confidence-value {
      font-size: 34px;
      font-weight: 800;
      color: #34d399;
      line-height: 1;
    }
    .confidence-meta {
      color: #94a3b8;
      font-size: 12px;
      margin-top: 6px;
    }
    .ring-wrap { position: relative; width: 78px; height: 78px; }
    .ring-wrap svg { width: 78px; height: 78px; }
    .ring-center {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 800;
      color: #34d399;
    }

    /* ===== INSIGHTS ===== */
    .insights {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }
    .insight {
      min-height: 118px;
      border-radius: 14px;
      padding: 14px 14px 14px 16px;
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.12);
    }
    .insight.tone-bull { border-right: 4px solid #22c55e; }
    .insight.tone-bear { border-right: 4px solid #ef4444; }
    .insight.tone-neutral { border-right: 4px solid #f59e0b; }
    .insight-title {
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .insight.tone-bull .insight-title { color: #4ade80; }
    .insight.tone-bear .insight-title { color: #f87171; }
    .insight.tone-neutral .insight-title { color: #fbbf24; }
    .insight-text {
      color: #cbd5e1;
      font-size: 12.5px;
      line-height: 1.75;
    }

    /* ===== MAIN 3 COLS ===== */
    .main {
      display: grid;
      grid-template-columns: 0.82fr 1.36fr 0.96fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 800;
      color: #93c5fd;
      margin-bottom: 12px;
    }
    .group-title {
      font-size: 12px;
      font-weight: 700;
      margin: 8px 0;
    }
    .group-title.resist { color: #fca5a5; }
    .group-title.support { color: #86efac; }
    .level-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      margin-bottom: 7px;
      background: #111827;
      border: 1px solid rgba(148,163,184,.08);
      font-size: 12.5px;
    }
    .level-label { color: #94a3b8; }
    .level-row.resist .level-value { color: #fca5a5; font-weight: 800; }
    .level-row.support .level-value { color: #86efac; font-weight: 800; }
    .range-box {
      margin-top: 12px;
      padding: 12px;
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(34,197,94,.08), rgba(239,68,68,.08));
      border: 1px dashed rgba(148,163,184,.28);
    }
    .range-box .k { color: #94a3b8; font-size: 11px; }
    .range-box .v { margin-top: 6px; font-size: 16px; font-weight: 800; }
    .range-box .s {
      margin-top: 6px;
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(251,191,36,.12);
      color: #fbbf24;
      font-size: 11px;
      font-weight: 700;
    }

    .chart-title {
      font-size: 14px;
      font-weight: 800;
      color: #93c5fd;
      margin-bottom: 10px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 10px;
    }
    .meta {
      text-align: center;
      background: #111827;
      border: 1px solid rgba(148,163,184,.1);
      border-radius: 12px;
      padding: 10px 6px;
    }
    .meta .k { color: #94a3b8; font-size: 11px; }
    .meta .v { margin-top: 6px; font-size: 13px; font-weight: 800; }

    .scenario {
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 8px;
      background: #111827;
      border: 1px solid rgba(148,163,184,.1);
    }
    .scenario.tone-bull { border-right: 3px solid #22c55e; }
    .scenario.tone-bear { border-right: 3px solid #ef4444; }
    .scenario.tone-neutral { border-right: 3px solid #f59e0b; }
    .scenario-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 800;
      margin-bottom: 7px;
      font-size: 13px;
    }
    .scenario.tone-bull .scenario-head { color: #4ade80; }
    .scenario.tone-bear .scenario-head { color: #f87171; }
    .scenario.tone-neutral .scenario-head { color: #fbbf24; }
    .scenario p {
      margin: 0;
      color: #cbd5e1;
      font-size: 12.5px;
      line-height: 1.7;
    }
    .targets {
      margin-top: 7px;
      color: #93c5fd;
      font-size: 12px;
      font-weight: 700;
    }

    /* ===== INDICATORS ===== */
    .indicators {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .indicator {
      min-height: 78px;
      text-align: center;
      border-radius: 12px;
      padding: 10px 6px;
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.12);
    }
    .indicator.tone-bull { box-shadow: inset 0 -3px 0 #22c55e; }
    .indicator.tone-bear { box-shadow: inset 0 -3px 0 #ef4444; }
    .indicator.tone-neutral { box-shadow: inset 0 -3px 0 #f59e0b; }
    .indicator-name {
      color: #94a3b8;
      font-size: 11px;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .indicator-status { font-size: 13px; font-weight: 800; }
    .indicator.tone-bull .indicator-status { color: #4ade80; }
    .indicator.tone-bear .indicator-status { color: #f87171; }
    .indicator.tone-neutral .indicator-status { color: #fbbf24; }

    /* ===== STRATEGIES ===== */
    .strategies {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .strategy {
      border-radius: 14px;
      padding: 14px 16px;
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.12);
    }
    .strategy.long { border-color: rgba(34,197,94,.35); background: linear-gradient(180deg, rgba(34,197,94,.08), #0b1526 40%); }
    .strategy.short { border-color: rgba(245,158,11,.35); background: linear-gradient(180deg, rgba(245,158,11,.08), #0b1526 40%); }
    .strategy-title {
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .strategy.long .strategy-title { color: #4ade80; }
    .strategy.short .strategy-title { color: #fbbf24; }
    .strategy-body {
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.85;
    }

    /* ===== SUMMARY BAR ===== */
    .summary-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .summary-item {
      text-align: center;
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.14);
      border-radius: 14px;
      padding: 14px 10px;
    }
    .summary-item .k {
      color: #94a3b8;
      font-size: 12px;
      font-weight: 600;
    }
    .summary-item .v {
      margin-top: 8px;
      font-size: 18px;
      font-weight: 800;
    }

    .disclaimer {
      border-radius: 12px;
      padding: 11px 14px;
      background: rgba(250, 204, 21, 0.08);
      border: 1px solid rgba(250, 204, 21, 0.22);
      color: #fde68a;
      font-size: 12px;
      line-height: 1.7;
      text-align: center;
    }
    .chart-empty {
      height: 300px;
      display: grid;
      place-items: center;
      color: #64748b;
      background: #0b1220;
      border-radius: 14px;
      border: 1px dashed rgba(148,163,184,.2);
    }
    .muted { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card" id="analysis-card">
    <div class="header">
      <div class="panel">
        <div class="brand-row">
          <div class="btc-logo">₿</div>
          <div>
            <div class="pair-name">${escapeHtml(analysis.pair_label || analysis.symbol)}</div>
            <div class="pair-sub">تحلیل اختصاصی بازار</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="field-label">تمایل (Bias)</div>
        <div class="bias-row">
          <div class="bias-value">${escapeHtml(analysis.bias || "خنثی")}</div>
          <div class="bias-chip">⟷</div>
        </div>
      </div>

      <div class="panel">
        <div class="confidence-row">
          <div>
            <div class="field-label">${escapeHtml(date)} · ${escapeHtml(time)}</div>
            <div class="confidence-value">${escapeHtml(confidence)}%</div>
            <div class="confidence-meta">میزان اطمینان</div>
          </div>
          <div class="ring-wrap">
            <svg viewBox="0 0 78 78">
              <circle cx="39" cy="39" r="30" fill="none" stroke="#1f2937" stroke-width="8" />
              <circle cx="39" cy="39" r="30" fill="none" stroke="#34d399" stroke-width="8"
                stroke-linecap="round"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}"
                transform="rotate(-90 39 39)" />
            </svg>
            <div class="ring-center">${escapeHtml(confidence)}%</div>
          </div>
        </div>
      </div>
    </div>

    <div class="insights">${insightHtml}</div>

    <div class="main">
      <div class="panel">
        <div class="section-title">سطوح کلیدی</div>
        <div class="group-title resist">مقاومت‌ها</div>
        ${renderLevels(analysis.key_resistance, "resist")}
        <div class="group-title support">حمایت‌ها</div>
        ${renderLevels(analysis.key_support, "support")}
        <div class="range-box">
          <div class="k">محدوده نوسان فعلی</div>
          <div class="v">${escapeHtml(analysis.current_range || "نامشخص")}</div>
          <div class="s">${escapeHtml(analysis.structure || analysis.bias || "خنثی")}</div>
        </div>
      </div>

      <div class="panel">
        <div class="chart-title">نمودار قیمت (1H)</div>
        ${buildCandleSvg(candles, analysis)}
        <div class="meta-grid">
          <div class="meta"><div class="k">تایم‌فریم</div><div class="v">1H / 4H</div></div>
          <div class="meta"><div class="k">ساختار کلی</div><div class="v">${escapeHtml(analysis.structure || "نامشخص")}</div></div>
          <div class="meta"><div class="k">حجم</div><div class="v">${escapeHtml(analysis.volume_status || "نامشخص")}</div></div>
          <div class="meta"><div class="k">مومنتوم</div><div class="v">${escapeHtml(analysis.momentum_status || "نامشخص")}</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="section-title">سناریوهای محتمل</div>
        <div class="scenario tone-bull">
          <div class="scenario-head"><span>صعودی</span><span>${escapeHtml(analysis.bullish_scenario_probability || 0)}%</span></div>
          <p>${escapeHtml(analysis.bullish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bullish_targets || []).map(formatPrice).join(" | "))}</div>
        </div>
        ${
          showNeutral
            ? `<div class="scenario tone-neutral">
                <div class="scenario-head"><span>خنثی</span><span>${escapeHtml(analysis.neutral_scenario_probability)}%</span></div>
                <p>${escapeHtml(analysis.neutral_scenario || "نامشخص")}</p>
              </div>`
            : ""
        }
        <div class="scenario tone-bear">
          <div class="scenario-head"><span>نزولی</span><span>${escapeHtml(analysis.bearish_scenario_probability || 0)}%</span></div>
          <p>${escapeHtml(analysis.bearish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bearish_targets || []).map(formatPrice).join(" | "))}</div>
        </div>
      </div>
    </div>

    <div class="indicators">${indicatorHtml}</div>

    <div class="strategies">
      <div class="strategy long">
        <div class="strategy-title">استراتژی بلندمدت</div>
        <div class="strategy-body">${escapeHtml(analysis.long_term_strategy || "نامشخص")}</div>
      </div>
      <div class="strategy short">
        <div class="strategy-title">استراتژی کوتاه‌مدت</div>
        <div class="strategy-body">${escapeHtml(analysis.short_term_strategy || "نامشخص")}</div>
      </div>
    </div>

    <div class="summary-bar">
      <div class="summary-item">
        <div class="k">روند بلندمدت</div>
        <div class="v" style="color:#34d399">${escapeHtml(analysis.long_term_trend || "نامشخص")}</div>
      </div>
      <div class="summary-item">
        <div class="k">روند کوتاه‌مدت</div>
        <div class="v" style="color:#fbbf24">${escapeHtml(analysis.short_term_trend || "نامشخص")}</div>
      </div>
      <div class="summary-item">
        <div class="k">احتمال ادامه صعودی</div>
        <div class="v" style="color:#34d399">${escapeHtml(analysis.bullish_probability || 0)}%</div>
      </div>
      <div class="summary-item">
        <div class="k">ریسک اصلاح کوتاه‌مدت</div>
        <div class="v" style="color:#f87171">${escapeHtml(analysis.correction_probability || analysis.bearish_probability || 0)}%</div>
      </div>
    </div>

    <div class="disclaimer">
      این تصویر صرفاً تحلیل وضعیت بازار است و سیگنال خرید/فروش یا توصیه مالی محسوب نمی‌شود.
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildAnalysisCardHtml,
};
