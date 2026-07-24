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
  return { date, time: `${time} UTC` };
}

function buildCandleSvg(candles = []) {
  if (!candles.length) {
    return `<div class="chart-empty">نمودار قیمت در دسترس نیست</div>`;
  }

  const width = 420;
  const height = 220;
  const pad = 16;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = Math.max(max - min, 1);
  const step = (width - pad * 2) / Math.max(candles.length - 1, 1);

  const body = candles
    .map((candle, index) => {
      const x = pad + index * step;
      const yHigh = pad + ((max - candle.high) / span) * (height - pad * 2);
      const yLow = pad + ((max - candle.low) / span) * (height - pad * 2);
      const yOpen = pad + ((max - candle.open) / span) * (height - pad * 2);
      const yClose = pad + ((max - candle.close) / span) * (height - pad * 2);
      const bullish = candle.close >= candle.open;
      const color = bullish ? "#22c55e" : "#ef4444";
      const top = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 2);

      return `
        <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.5" />
        <rect x="${x - 3}" y="${top}" width="6" height="${bodyHeight}" fill="${color}" rx="1" />
      `;
    })
    .join("");

  const last = candles[candles.length - 1];
  const lastY = pad + ((max - last.close) / span) * (height - pad * 2);

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="220" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#0b1220" rx="12" />
      ${body}
      <line x1="${pad}" y1="${lastY}" x2="${width - pad}" y2="${lastY}" stroke="#94a3b8" stroke-dasharray="4 4" />
      <text x="${width - pad}" y="${Math.max(lastY - 6, 18)}" fill="#e2e8f0" font-size="12" text-anchor="end">${escapeHtml(last.close)}</text>
    </svg>
  `;
}

function renderList(items, empty = "نامشخص") {
  if (!items?.length) {
    return `<div class="muted">${escapeHtml(empty)}</div>`;
  }

  return items.map((item) => `<div class="level-item">${escapeHtml(item)}</div>`).join("");
}

function buildAnalysisCardHtml(analysis, candles = []) {
  const { date, time } = formatNow();
  const insights = (analysis.insights || [])
    .map(
      (item) => `
      <div class="insight ${toneClass(item.tone)}">
        <div class="insight-title">${escapeHtml(item.title)}</div>
        <div class="insight-text">${escapeHtml(item.text)}</div>
      </div>`,
    )
    .join("");

  const indicators = (analysis.indicators || [])
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
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Vazirmatn", sans-serif;
      background: #020617;
      color: #e5eefc;
    }
    .card {
      width: 1280px;
      min-height: 900px;
      padding: 28px;
      background:
        radial-gradient(circle at top left, rgba(56,189,248,0.12), transparent 30%),
        radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 28%),
        linear-gradient(180deg, #07111f 0%, #020617 100%);
    }
    .header {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 18px;
    }
    .box {
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 18px;
      padding: 16px 18px;
    }
    .pair {
      font-size: 28px;
      font-weight: 800;
    }
    .sub {
      color: #94a3b8;
      margin-top: 6px;
      font-size: 14px;
    }
    .bias-value {
      font-size: 30px;
      font-weight: 800;
      color: #fbbf24;
    }
    .confidence-value {
      font-size: 34px;
      font-weight: 800;
      color: #34d399;
    }
    .insights {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }
    .insight {
      border-radius: 16px;
      padding: 14px;
      min-height: 110px;
      border: 1px solid rgba(148,163,184,0.15);
      background: #0b1526;
    }
    .insight-title { font-weight: 700; margin-bottom: 8px; font-size: 14px; }
    .insight-text { font-size: 13px; line-height: 1.7; color: #cbd5e1; }
    .tone-bull { box-shadow: inset 3px 0 0 #22c55e; }
    .tone-bear { box-shadow: inset 3px 0 0 #ef4444; }
    .tone-neutral { box-shadow: inset 3px 0 0 #f59e0b; }
    .main {
      display: grid;
      grid-template-columns: 0.9fr 1.2fr 0.9fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #93c5fd;
    }
    .level-item {
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(30, 41, 59, 0.8);
      margin-bottom: 8px;
      font-size: 13px;
    }
    .label-resist { color: #fca5a5; font-size: 12px; margin: 8px 0; }
    .label-support { color: #86efac; font-size: 12px; margin: 8px 0; }
    .chart-title { margin-bottom: 10px; font-weight: 700; }
    .meta-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 12px;
    }
    .meta {
      background: #111827;
      border-radius: 12px;
      padding: 10px;
      text-align: center;
    }
    .meta .k { color: #94a3b8; font-size: 11px; }
    .meta .v { margin-top: 6px; font-weight: 700; font-size: 13px; }
    .scenario {
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 10px;
      background: #0b1526;
      border: 1px solid rgba(148,163,184,0.12);
    }
    .scenario-head {
      display: flex;
      justify-content: space-between;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .scenario p { margin: 0; font-size: 13px; line-height: 1.7; color: #cbd5e1; }
    .targets { margin-top: 8px; color: #93c5fd; font-size: 12px; }
    .indicators {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .indicator {
      background: #0b1526;
      border-radius: 12px;
      padding: 10px 8px;
      text-align: center;
      border: 1px solid rgba(148,163,184,0.12);
      min-height: 74px;
    }
    .indicator-name { font-size: 11px; color: #94a3b8; margin-bottom: 8px; }
    .indicator-status { font-size: 13px; font-weight: 700; }
    .strategies {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }
    .footer {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .footer .box { text-align: center; }
    .footer .k { color: #94a3b8; font-size: 12px; }
    .footer .v { margin-top: 8px; font-size: 18px; font-weight: 800; }
    .disclaimer {
      background: rgba(250, 204, 21, 0.08);
      border: 1px solid rgba(250, 204, 21, 0.25);
      color: #fde68a;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 12px;
      line-height: 1.7;
    }
    .muted { color: #94a3b8; }
    .chart-empty {
      height: 220px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      background: #0b1220;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <div class="card" id="analysis-card">
    <div class="header">
      <div class="box">
        <div class="pair">${escapeHtml(analysis.pair_label || analysis.symbol)}</div>
        <div class="sub">${escapeHtml(analysis.title || "تحلیل اختصاصی بازار")}</div>
      </div>
      <div class="box">
        <div class="sub">بایاس بازار</div>
        <div class="bias-value">${escapeHtml(analysis.bias || "خنثی")}</div>
      </div>
      <div class="box">
        <div class="sub">${escapeHtml(date)} · ${escapeHtml(time)}</div>
        <div class="confidence-value">${escapeHtml(analysis.confidence)}%</div>
        <div class="sub">میزان اعتماد تحلیل</div>
      </div>
    </div>

    <div class="insights">
      ${insights || `<div class="insight tone-neutral"><div class="insight-title">خلاصه</div><div class="insight-text">${escapeHtml(analysis.summary || "داده‌ای موجود نیست")}</div></div>`}
    </div>

    <div class="main">
      <div class="box">
        <div class="section-title">سطوح کلیدی</div>
        <div class="label-resist">مقاومت‌ها</div>
        ${renderList(analysis.key_resistance)}
        <div class="label-support">حمایت‌ها</div>
        ${renderList(analysis.key_support)}
        <div class="sub" style="margin-top:12px">محدوده فعلی</div>
        <div class="level-item">${escapeHtml(analysis.current_range || "نامشخص")}</div>
      </div>

      <div class="box">
        <div class="chart-title">نمودار قیمت (1H)</div>
        ${buildCandleSvg(candles)}
        <div class="meta-row">
          <div class="meta"><div class="k">ساختار</div><div class="v">${escapeHtml(analysis.structure || "نامشخص")}</div></div>
          <div class="meta"><div class="k">حجم</div><div class="v">${escapeHtml(analysis.volume_status || "نامشخص")}</div></div>
          <div class="meta"><div class="k">مومنتوم</div><div class="v">${escapeHtml(analysis.momentum_status || "نامشخص")}</div></div>
          <div class="meta"><div class="k">قیمت</div><div class="v">${escapeHtml(analysis.current_price || "-")}</div></div>
        </div>
      </div>

      <div class="box">
        <div class="section-title">سناریوهای محتمل</div>
        <div class="scenario tone-bull">
          <div class="scenario-head"><span>صعودی</span><span>${escapeHtml(analysis.bullish_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.bullish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bullish_targets || []).join(" | ") || "")}</div>
        </div>
        <div class="scenario tone-neutral">
          <div class="scenario-head"><span>خنثی / نوسانی</span><span>${escapeHtml(analysis.neutral_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.neutral_scenario || "نامشخص")}</p>
        </div>
        <div class="scenario tone-bear">
          <div class="scenario-head"><span>نزولی</span><span>${escapeHtml(analysis.bearish_scenario_probability)}%</span></div>
          <p>${escapeHtml(analysis.bearish_scenario || "نامشخص")}</p>
          <div class="targets">${escapeHtml((analysis.bearish_targets || []).join(" | ") || "")}</div>
        </div>
      </div>
    </div>

    <div class="indicators">
      ${indicators || `<div class="indicator tone-neutral"><div class="indicator-name">وضعیت</div><div class="indicator-status">${escapeHtml(analysis.trend)}</div></div>`}
    </div>

    <div class="strategies">
      <div class="box">
        <div class="section-title">استراتژی کوتاه‌مدت</div>
        <div style="font-size:13px;line-height:1.8;color:#cbd5e1">${escapeHtml(analysis.short_term_strategy || "نامشخص")}</div>
      </div>
      <div class="box">
        <div class="section-title">استراتژی بلندمدت</div>
        <div style="font-size:13px;line-height:1.8;color:#cbd5e1">${escapeHtml(analysis.long_term_strategy || "نامشخص")}</div>
      </div>
    </div>

    <div class="footer">
      <div class="box"><div class="k">روند کوتاه‌مدت</div><div class="v">${escapeHtml(analysis.short_term_trend || "نامشخص")}</div></div>
      <div class="box"><div class="k">روند بلندمدت</div><div class="v">${escapeHtml(analysis.long_term_trend || "نامشخص")}</div></div>
      <div class="box"><div class="k">احتمال ادامه صعودی</div><div class="v" style="color:#34d399">${escapeHtml(analysis.bullish_probability)}%</div></div>
      <div class="box"><div class="k">ریسک اصلاح</div><div class="v" style="color:#f87171">${escapeHtml(analysis.bearish_probability)}%</div></div>
    </div>

    <div class="disclaimer">
      این تصویر فقط تحلیل وضعیت بازار بر اساس CoinEx AI Research است و سیگنال خرید/فروش یا توصیه مالی محسوب نمی‌شود.
      ${escapeHtml(analysis.risk_notes ? ` نکات ریسک: ${analysis.risk_notes}` : "")}
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildAnalysisCardHtml,
};
