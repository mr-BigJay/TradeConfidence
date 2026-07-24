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

function toneIcon(tone) {
  if (tone === "bullish") return "▲";
  if (tone === "bearish") return "▼";
  return "◆";
}

function formatNow() {
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
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

  const width = 520;
  const height = 280;
  const padX = 22;
  const padY = 24;
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

  const grid = [0.2, 0.4, 0.6, 0.8]
    .map((ratio) => {
      const y = padY + ratio * (height - padY * 2);
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(148,163,184,0.12)" stroke-width="1" />`;
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
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 2.5);
      return `
        <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.6" />
        <rect x="${x - 3.6}" y="${top}" width="7.2" height="${bodyHeight}" fill="${color}" rx="1.4" />
      `;
    })
    .join("");

  const resistanceLines = (analysis.key_resistance || [])
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `
        <line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#ef4444" stroke-dasharray="6 5" stroke-width="1.4" opacity="0.9" />
        <text x="${padX + 4}" y="${y - 5}" fill="#fca5a5" font-size="11" font-family="Vazirmatn, sans-serif">${escapeHtml(formatPrice(level))}</text>
      `;
    })
    .join("");

  const supportLines = (analysis.key_support || [])
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `
        <line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#22c55e" stroke-dasharray="6 5" stroke-width="1.4" opacity="0.9" />
        <text x="${padX + 4}" y="${y - 5}" fill="#86efac" font-size="11" font-family="Vazirmatn, sans-serif">${escapeHtml(formatPrice(level))}</text>
      `;
    })
    .join("");

  const last = candles[candles.length - 1];
  const lastX = padX + (candles.length - 1) * step;
  const lastY = yFor(last.close);
  const priceLabel = formatPrice(analysis.current_price || last.close);

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chartBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0d1b33" />
          <stop offset="100%" stop-color="#07111f" />
        </linearGradient>
        <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#chartBg)" rx="16" />
      ${grid}
      ${resistanceLines}
      ${supportLines}
      ${body}
      <circle cx="${lastX}" cy="${lastY}" r="5" fill="#f8fafc" filter="url(#softGlow)" />
      <rect x="${width - 118}" y="${Math.max(lastY - 16, 12)}" width="100" height="26" rx="9" fill="#0f172a" stroke="#334155" />
      <text x="${width - 68}" y="${Math.max(lastY + 2, 30)}" fill="#f8fafc" font-size="13" text-anchor="middle" font-family="Vazirmatn, sans-serif" font-weight="700">${escapeHtml(priceLabel)}</text>
    </svg>
  `;
}

function renderLevels(items, className) {
  if (!items?.length) {
    return `<div class="level-item muted">نامشخص</div>`;
  }

  const labels = className === "resist"
    ? ["مقاومت اصلی", "مقاومت بعدی", "هدف بالاتر"]
    : ["حمایت نزدیک", "حمایت میانی", "حمایت اصلی"];

  return items
    .map((item, index) => `
      <div class="level-item ${className}">
        <span>${escapeHtml(labels[index] || "سطح")}</span>
        <strong>${escapeHtml(formatPrice(item))}</strong>
      </div>`)
    .join("");
}

function buildAnalysisCardHtml(analysis, candles = []) {
  const { date, time } = formatNow();
  const confidence = Number(analysis.confidence) || 0;
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (confidence / 100) * circumference;

  const insights = (analysis.insights || [])
    .slice(0, 4)
    .map(
      (item) => `
      <div class="insight ${toneClass(item.tone)}">
        <div class="insight-top">
          <span class="insight-icon">${toneIcon(item.tone)}</span>
          <div class="insight-title">${escapeHtml(item.title)}</div>
        </div>
        <div class="insight-text">${escapeHtml(item.text)}</div>
      </div>`,
    )
    .join("");

  const indicators = (analysis.indicators || [])
    .slice(0, 7)
    .map(
      (item) => `
      <div class="indicator ${toneClass(item.tone)}">
        <div class="indicator-name">${escapeHtml(item.name)}</div>
        <div class="indicator-status">${escapeHtml(item.status)}</div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #020617;
      color: #e8eefc;
      font-family: "Vazirmatn", sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }
    .card {
      width: 1480px;
      padding: 28px;
      background:
        radial-gradient(circle at 8% -10%, rgba(56,189,248,.18), transparent 32%),
        radial-gradient(circle at 92% 0%, rgba(34,197,94,.14), transparent 28%),
        radial-gradient(circle at 50% 100%, rgba(245,158,11,.08), transparent 35%),
        linear-gradient(180deg, #0a1424 0%, #020617 55%, #01040c 100%);
    }
    .header {
      display: grid;
      grid-template-columns: 1.35fr 1fr 1.05fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .panel {
      background: linear-gradient(180deg, rgba(15,23,42,.96), rgba(8,15,30,.96));
      border: 1px solid rgba(148,163,184,.16);
      border-radius: 20px;
      padding: 18px 20px;
      box-shadow: 0 14px 40px rgba(0,0,0,.28);
      backdrop-filter: blur(8px);
    }
    .pair {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }
    .btc-badge {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, #ffd28a, #f7931a 55%, #d97706);
      display: grid;
      place-items: center;
      font-weight: 800;
      color: #111;
      box-shadow: 0 0 18px rgba(247,147,26,.35);
      font-size: 22px;
    }
    .subtitle {
      color: #93c5fd;
      margin-top: 10px;
      font-size: 15px;
      font-weight: 600;
    }
    .center-label {
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .bias {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .bias-value {
      font-size: 36px;
      font-weight: 800;
      color: #fbbf24;
      text-shadow: 0 0 18px rgba(251,191,36,.2);
    }
    .bias-arrow {
      width: 54px;
      height: 54px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: rgba(245,158,11,.12);
      border: 1px solid rgba(245,158,11,.28);
      color: #f59e0b;
      font-size: 26px;
    }
    .confidence-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .confidence-value {
      font-size: 40px;
      font-weight: 800;
      color: #34d399;
      text-shadow: 0 0 18px rgba(52,211,153,.22);
    }
    .ring { width: 74px; height: 74px; }
    .insights {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }
    .insight {
      min-height: 128px;
      border-radius: 18px;
      padding: 16px;
      background: linear-gradient(180deg, #102038, #0a1322);
      border: 1px solid rgba(148,163,184,.12);
      position: relative;
      overflow: hidden;
    }
    .insight::after {
      content: "";
      position: absolute;
      inset: auto -20% -40% auto;
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: rgba(148,163,184,.05);
    }
    .insight-top {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      position: relative;
      z-index: 1;
    }
    .insight-icon {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      font-size: 12px;
      background: rgba(255,255,255,.04);
    }
    .insight-title {
      font-weight: 800;
      font-size: 14px;
      position: relative;
      z-index: 1;
    }
    .insight-text {
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.8;
      position: relative;
      z-index: 1;
    }
    .tone-bull { box-shadow: inset 4px 0 0 #22c55e, 0 10px 24px rgba(34,197,94,.06); }
    .tone-bear { box-shadow: inset 4px 0 0 #ef4444, 0 10px 24px rgba(239,68,68,.06); }
    .tone-neutral { box-shadow: inset 4px 0 0 #f59e0b, 0 10px 24px rgba(245,158,11,.06); }
    .tone-bull .insight-icon, .tone-bull .indicator-status { color: #4ade80; }
    .tone-bear .insight-icon, .tone-bear .indicator-status { color: #f87171; }
    .tone-neutral .insight-icon, .tone-neutral .indicator-status { color: #fbbf24; }
    .main {
      display: grid;
      grid-template-columns: 0.88fr 1.28fr 0.98fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 800;
      color: #93c5fd;
      margin-bottom: 12px;
      letter-spacing: -.2px;
    }
    .level-group-title {
      font-size: 12px;
      margin: 10px 0 8px;
      font-weight: 700;
      letter-spacing: .2px;
    }
    .level-group-title.resist { color: #fca5a5; }
    .level-group-title.support { color: #86efac; }
    .level-item {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 11px 12px;
      border-radius: 12px;
      margin-bottom: 8px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(148,163,184,.08);
      font-size: 13px;
    }
    .level-item.resist strong { color: #fca5a5; font-size: 14px; }
    .level-item.support strong { color: #86efac; font-size: 14px; }
    .range-box {
      margin-top: 14px;
      padding: 14px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(30,41,59,.9), rgba(15,23,42,.95));
      border: 1px dashed rgba(148,163,184,.28);
    }
    .range-box .k { color: #94a3b8; font-size: 12px; }
    .range-box .v { margin-top: 7px; font-weight: 800; font-size: 18px; }
    .chart-title { font-weight: 800; margin-bottom: 12px; font-size: 15px; color: #93c5fd; }
    .meta-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 12px;
    }
    .meta {
      text-align: center;
      background: linear-gradient(180deg, #121c2f, #0b1220);
      border-radius: 14px;
      padding: 12px 8px;
      border: 1px solid rgba(148,163,184,.1);
    }
    .meta .k { color: #94a3b8; font-size: 11px; font-weight: 600; }
    .meta .v { margin-top: 7px; font-size: 13px; font-weight: 800; }
    .scenario {
      border-radius: 16px;
      padding: 14px;
      margin-bottom: 10px;
      background: linear-gradient(180deg, #101c31, #0a1424);
      border: 1px solid rgba(148,163,184,.1);
    }
    .scenario-head {
      display: flex;
      justify-content: space-between;
      font-weight: 800;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .scenario p {
      margin: 0;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.8;
    }
    .targets {
      margin-top: 9px;
      color: #93c5fd;
      font-size: 12px;
      font-weight: 700;
    }
    .indicators {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .indicator {
      min-height: 86px;
      text-align: center;
      border-radius: 14px;
      padding: 12px 8px;
      background: linear-gradient(180deg, #101c31, #0a1424);
      border: 1px solid rgba(148,163,184,.1);
    }
    .indicator-name { color: #94a3b8; font-size: 11px; margin-bottom: 10px; font-weight: 600; }
    .indicator-status { font-size: 13px; font-weight: 800; }
    .strategies {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .strategy.long { box-shadow: inset 0 0 0 1px rgba(34,197,94,.28), 0 10px 24px rgba(34,197,94,.05); }
    .strategy.short { box-shadow: inset 0 0 0 1px rgba(245,158,11,.28), 0 10px 24px rgba(245,158,11,.05); }
    .strategy-body {
      color: #cbd5e1;
      font-size: 13.5px;
      line-height: 1.9;
    }
    .footer {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .footer .panel { text-align: center; padding-top: 18px; padding-bottom: 18px; }
    .footer .k { color: #94a3b8; font-size: 12px; font-weight: 600; }
    .footer .v { margin-top: 8px; font-size: 20px; font-weight: 800; }
    .disclaimer {
      border-radius: 14px;
      padding: 13px 15px;
      background: rgba(250, 204, 21, 0.08);
      border: 1px solid rgba(250, 204, 21, 0.22);
      color: #fde68a;
      font-size: 12.5px;
      line-height: 1.75;
    }
    .chart-empty {
      height: 280px;
      display: grid;
      place-items: center;
      color: #64748b;
      background: #0b1220;
      border-radius: 16px;
      border: 1px dashed rgba(148,163,184,.2);
    }
    .muted { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card" id="analysis-card">
    <div class="header">
      <div class="panel">
        <div class="pair">
          <div class="btc-badge">₿</div>
          <div>${escapeHtml(analysis.pair_label || analysis.symbol)}</div>
        </div>
        <div class="subtitle">تحلیل اختصاصی بازار</div>
      </div>
      <div class="panel">
        <div class="center-label">تمایل بازار</div>
        <div class="bias">
          <div class="bias-value">${escapeHtml(analysis.bias || "خنثی")}</div>
          <div class="bias-arrow">⟷</div>
        </div>
      </div>
      <div class="panel">
        <div class="confidence-wrap">
          <div>
            <div class="center-label">${escapeHtml(date)} · ${escapeHtml(time)}</div>
            <div class="confidence-value">${escapeHtml(confidence)}%</div>
            <div class="center-label">میزان اطمینان</div>
          </div>
          <svg class="ring" viewBox="0 0 74 74">
            <circle cx="37" cy="37" r="28" fill="none" stroke="#1f2937" stroke-width="8" />
            <circle cx="37" cy="37" r="28" fill="none" stroke="#34d399" stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"
              transform="rotate(-90 37 37)" />
          </svg>
        </div>
      </div>
    </div>

    <div class="insights">
      ${insights || `<div class="insight tone-neutral"><div class="insight-top"><span class="insight-icon">◆</span><div class="insight-title">خلاصه</div></div><div class="insight-text">${escapeHtml(analysis.summary || "داده‌ای موجود نیست")}</div></div>`}
    </div>

    <div class="main">
      <div class="panel">
        <div class="section-title">سطوح کلیدی</div>
        <div class="level-group-title resist">مقاومت‌ها</div>
        ${renderLevels(analysis.key_resistance, "resist")}
        <div class="level-group-title support">حمایت‌ها</div>
        ${renderLevels(analysis.key_support, "support")}
        <div class="range-box">
          <div class="k">محدوده فعلی</div>
          <div class="v">${escapeHtml(analysis.current_range || "نامشخص")}</div>
        </div>
      </div>

      <div class="panel">
        <div class="chart-title">نمودار قیمت (1H)</div>
        ${buildCandleSvg(candles, analysis)}
        <div class="meta-row">
          <div class="meta"><div class="k">تایم‌فریم</div><div class="v">1H / 4H</div></div>
          <div class="meta"><div class="k">ساختار</div><div class="v">${escapeHtml(analysis.structure || "نامشخص")}</div></div>
          <div class="meta"><div class="k">حجم</div><div class="v">${escapeHtml(analysis.volume_status || "نامشخص")}</div></div>
          <div class="meta"><div class="k">مومنتوم</div><div class="v">${escapeHtml(analysis.momentum_status || "نامشخص")}</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="section-title">سناریوهای محتمل</div>
        <div class="scenario tone-bull">
          <div class="scenario-head"><span>▲ سناریوی صعودی</span><span>${escapeHtml(analysis.bullish_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.bullish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bullish_targets || []).map(formatPrice).join(" | "))}</div>
        </div>
        ${
          Number(analysis.neutral_scenario_probability) > 0
            ? `<div class="scenario tone-neutral">
                <div class="scenario-head"><span>◆ سناریوی خنثی</span><span>${escapeHtml(analysis.neutral_scenario_probability)}%</span></div>
                <p>${escapeHtml(analysis.neutral_scenario || "نامشخص")}</p>
              </div>`
            : ""
        }
        <div class="scenario tone-bear">
          <div class="scenario-head"><span>▼ سناریوی نزولی</span><span>${escapeHtml(analysis.bearish_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.bearish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bearish_targets || []).map(formatPrice).join(" | "))}</div>
        </div>
      </div>
    </div>

    <div class="indicators">
      ${indicators || `<div class="indicator tone-neutral"><div class="indicator-name">وضعیت</div><div class="indicator-status">${escapeHtml(analysis.bias)}</div></div>`}
    </div>

    <div class="strategies">
      <div class="panel strategy long">
        <div class="section-title">استراتژی بلندمدت</div>
        <div class="strategy-body">${escapeHtml(analysis.long_term_strategy || "نامشخص")}</div>
      </div>
      <div class="panel strategy short">
        <div class="section-title">استراتژی کوتاه‌مدت</div>
        <div class="strategy-body">${escapeHtml(analysis.short_term_strategy || "نامشخص")}</div>
      </div>
    </div>

    <div class="footer">
      <div class="panel"><div class="k">روند بلندمدت</div><div class="v" style="color:#34d399">${escapeHtml(analysis.long_term_trend || "نامشخص")}</div></div>
      <div class="panel"><div class="k">روند کوتاه‌مدت</div><div class="v" style="color:#fbbf24">${escapeHtml(analysis.short_term_trend || "نامشخص")}</div></div>
      <div class="panel"><div class="k">احتمال ادامه صعودی</div><div class="v" style="color:#34d399">${escapeHtml(analysis.bullish_probability)}%</div></div>
      <div class="panel"><div class="k">ریسک اصلاح کوتاه‌مدت</div><div class="v" style="color:#f87171">${escapeHtml(analysis.correction_probability || analysis.bearish_probability)}%</div></div>
    </div>

    <div class="disclaimer">
      این کارت فقط تحلیل وضعیت بازار است و سیگنال خرید/فروش یا توصیه مالی محسوب نمی‌شود.
      ${escapeHtml(analysis.risk_notes ? ` | نکات ریسک: ${analysis.risk_notes}` : "")}
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildAnalysisCardHtml,
};
