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

function buildCandleSvg(candles = [], analysis = {}) {
  if (!candles.length) {
    return `<div class="chart-empty">نمودار قیمت در دسترس نیست</div>`;
  }

  const width = 460;
  const height = 250;
  const padX = 18;
  const padY = 18;
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
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 2);
      return `
        <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.4" />
        <rect x="${x - 3.2}" y="${top}" width="6.4" height="${bodyHeight}" fill="${color}" rx="1" />
      `;
    })
    .join("");

  const resistanceLines = (analysis.key_resistance || [])
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#ef4444" stroke-dasharray="5 4" stroke-width="1.2" opacity="0.85" />`;
    })
    .join("");

  const supportLines = (analysis.key_support || [])
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#22c55e" stroke-dasharray="5 4" stroke-width="1.2" opacity="0.85" />`;
    })
    .join("");

  const last = candles[candles.length - 1];
  const lastY = yFor(last.close);
  const priceLabel = analysis.current_price || String(last.close);

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="250" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chartBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0b1730" />
          <stop offset="100%" stop-color="#07101f" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#chartBg)" rx="14" />
      ${resistanceLines}
      ${supportLines}
      ${body}
      <circle cx="${padX + (candles.length - 1) * step}" cy="${lastY}" r="4.5" fill="#f8fafc" />
      <rect x="${width - 108}" y="${Math.max(lastY - 14, 10)}" width="90" height="22" rx="8" fill="#111827" stroke="#334155" />
      <text x="${width - 63}" y="${Math.max(lastY + 1, 25)}" fill="#f8fafc" font-size="12" text-anchor="middle" font-family="Vazirmatn, sans-serif">${escapeHtml(priceLabel)}</text>
    </svg>
  `;
}

function renderLevels(items, className) {
  if (!items?.length) {
    return `<div class="level-item muted">نامشخص</div>`;
  }

  return items
    .map((item, index) => {
      const label = index === 0 ? "اصلی" : index === 1 ? "میانی" : "بعدی";
      return `
        <div class="level-item ${className}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(item)}</strong>
        </div>`;
    })
    .join("");
}

function buildAnalysisCardHtml(analysis, candles = []) {
  const { date, time } = formatNow();
  const confidence = Number(analysis.confidence) || 0;
  const circumference = 2 * Math.PI * 26;
  const offset = circumference - (confidence / 100) * circumference;

  const insights = (analysis.insights || [])
    .slice(0, 4)
    .map(
      (item) => `
      <div class="insight ${toneClass(item.tone)}">
        <div class="insight-title">${escapeHtml(item.title)}</div>
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
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #020617;
      color: #e5eefc;
      font-family: "Vazirmatn", sans-serif;
    }
    .card {
      width: 1400px;
      padding: 26px;
      background:
        radial-gradient(circle at 12% 0%, rgba(56,189,248,.16), transparent 28%),
        radial-gradient(circle at 88% 0%, rgba(34,197,94,.12), transparent 24%),
        linear-gradient(180deg, #08111f 0%, #020617 100%);
    }
    .header {
      display: grid;
      grid-template-columns: 1.3fr 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .panel {
      background: rgba(8, 17, 34, 0.94);
      border: 1px solid rgba(148,163,184,.16);
      border-radius: 18px;
      padding: 16px 18px;
      box-shadow: 0 10px 30px rgba(0,0,0,.22);
    }
    .pair {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 30px;
      font-weight: 800;
    }
    .btc-badge {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f7931a, #ffb020);
      display: grid;
      place-items: center;
      font-weight: 800;
      color: #111;
    }
    .subtitle { color: #93c5fd; margin-top: 8px; font-size: 14px; }
    .center-label { color: #94a3b8; font-size: 13px; margin-bottom: 8px; }
    .bias {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .bias-value {
      font-size: 34px;
      font-weight: 800;
      color: #fbbf24;
    }
    .bias-arrow {
      font-size: 28px;
      color: #f59e0b;
      letter-spacing: -4px;
    }
    .confidence-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .confidence-value {
      font-size: 36px;
      font-weight: 800;
      color: #34d399;
    }
    .ring {
      width: 68px;
      height: 68px;
    }
    .insights {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }
    .insight {
      min-height: 118px;
      border-radius: 16px;
      padding: 14px;
      background: linear-gradient(180deg, #0b162b, #09101d);
      border: 1px solid rgba(148,163,184,.12);
    }
    .insight-title { font-weight: 800; margin-bottom: 8px; font-size: 14px; }
    .insight-text { color: #cbd5e1; font-size: 12.5px; line-height: 1.75; }
    .tone-bull { box-shadow: inset 4px 0 0 #22c55e; }
    .tone-bear { box-shadow: inset 4px 0 0 #ef4444; }
    .tone-neutral { box-shadow: inset 4px 0 0 #f59e0b; }
    .main {
      display: grid;
      grid-template-columns: 0.85fr 1.3fr 0.95fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 800;
      color: #93c5fd;
      margin-bottom: 12px;
    }
    .level-group-title {
      font-size: 12px;
      margin: 10px 0 8px;
      font-weight: 700;
    }
    .level-group-title.resist { color: #fca5a5; }
    .level-group-title.support { color: #86efac; }
    .level-item {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 11px;
      border-radius: 11px;
      margin-bottom: 8px;
      background: rgba(15, 23, 42, 0.9);
      font-size: 13px;
    }
    .level-item.resist strong { color: #fca5a5; }
    .level-item.support strong { color: #86efac; }
    .range-box {
      margin-top: 12px;
      padding: 12px;
      border-radius: 12px;
      background: #111827;
      border: 1px dashed rgba(148,163,184,.25);
    }
    .range-box .k { color: #94a3b8; font-size: 12px; }
    .range-box .v { margin-top: 6px; font-weight: 800; font-size: 16px; }
    .chart-title { font-weight: 800; margin-bottom: 10px; }
    .meta-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 12px;
    }
    .meta {
      text-align: center;
      background: #0b1220;
      border-radius: 12px;
      padding: 10px 8px;
      border: 1px solid rgba(148,163,184,.1);
    }
    .meta .k { color: #94a3b8; font-size: 11px; }
    .meta .v { margin-top: 6px; font-size: 13px; font-weight: 800; }
    .scenario {
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 10px;
      background: #0a1424;
      border: 1px solid rgba(148,163,184,.1);
    }
    .scenario-head {
      display: flex;
      justify-content: space-between;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .scenario p {
      margin: 0;
      color: #cbd5e1;
      font-size: 12.5px;
      line-height: 1.75;
    }
    .targets {
      margin-top: 8px;
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
      min-height: 78px;
      text-align: center;
      border-radius: 12px;
      padding: 10px 8px;
      background: #0a1424;
      border: 1px solid rgba(148,163,184,.1);
    }
    .indicator-name { color: #94a3b8; font-size: 11px; margin-bottom: 8px; }
    .indicator-status { font-size: 13px; font-weight: 800; }
    .strategies {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .strategy.long { box-shadow: inset 0 0 0 1px rgba(34,197,94,.25); }
    .strategy.short { box-shadow: inset 0 0 0 1px rgba(245,158,11,.25); }
    .strategy-body {
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.85;
    }
    .footer {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .footer .panel { text-align: center; }
    .footer .k { color: #94a3b8; font-size: 12px; }
    .footer .v { margin-top: 8px; font-size: 18px; font-weight: 800; }
    .disclaimer {
      border-radius: 12px;
      padding: 12px 14px;
      background: rgba(250, 204, 21, 0.08);
      border: 1px solid rgba(250, 204, 21, 0.22);
      color: #fde68a;
      font-size: 12px;
      line-height: 1.7;
    }
    .chart-empty {
      height: 250px;
      display: grid;
      place-items: center;
      color: #64748b;
      background: #0b1220;
      border-radius: 14px;
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
          <svg class="ring" viewBox="0 0 68 68">
            <circle cx="34" cy="34" r="26" fill="none" stroke="#1f2937" stroke-width="8" />
            <circle cx="34" cy="34" r="26" fill="none" stroke="#34d399" stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"
              transform="rotate(-90 34 34)" />
          </svg>
        </div>
      </div>
    </div>

    <div class="insights">
      ${insights || `<div class="insight tone-neutral"><div class="insight-title">خلاصه</div><div class="insight-text">${escapeHtml(analysis.summary || "داده‌ای موجود نیست")}</div></div>`}
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
          <div class="scenario-head"><span>سناریوی صعودی</span><span>${escapeHtml(analysis.bullish_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.bullish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bullish_targets || []).join(" | "))}</div>
        </div>
        ${
          Number(analysis.neutral_scenario_probability) > 0
            ? `<div class="scenario tone-neutral">
                <div class="scenario-head"><span>سناریوی خنثی</span><span>${escapeHtml(analysis.neutral_scenario_probability)}%</span></div>
                <p>${escapeHtml(analysis.neutral_scenario || "نامشخص")}</p>
              </div>`
            : ""
        }
        <div class="scenario tone-bear">
          <div class="scenario-head"><span>سناریوی نزولی</span><span>${escapeHtml(analysis.bearish_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.bearish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bearish_targets || []).join(" | "))}</div>
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
