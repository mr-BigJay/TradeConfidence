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

function biasClass(bias) {
  const text = String(bias || "");
  if (/صعودی|bull/i.test(text)) return "bias-bull";
  if (/نزولی|bear/i.test(text)) return "bias-bear";
  return "bias-neutral";
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
  return { date, time: `${time} UTC` };
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
    return `<div class="chart-empty">نمودار در دسترس نیست</div>`;
  }

  // Portrait chart canvas (fits 1080-wide phone story)
  const width = 980;
  const height = 420;
  const padLeft = 12;
  const padRight = 86;
  const padY = 20;
  const plotLeft = padLeft;
  const plotRight = width - padRight;
  const plotWidth = plotRight - plotLeft;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const levelValues = [...(analysis.key_resistance || []), ...(analysis.key_support || [])]
    .map(parseLevel)
    .filter((value) => value !== null);

  const max = Math.max(...highs, ...(levelValues.length ? levelValues : [0]));
  const min = Math.min(...lows, ...(levelValues.length ? levelValues : highs));
  const span = Math.max(max - min, 1);
  const step = plotWidth / Math.max(candles.length, 1);
  const bodyWidth = Math.max(1.1, Math.min(step * 0.52, 3.4));
  const wickWidth = Math.max(0.8, Math.min(bodyWidth * 0.35, 1.4));
  const yFor = (price) => padY + ((max - price) / span) * (height - padY * 2);

  const grid = [0.2, 0.4, 0.6, 0.8]
    .map((ratio) => {
      const y = padY + ratio * (height - padY * 2);
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="rgba(100,116,139,0.16)" stroke-width="1" />`;
    })
    .join("");

  const body = candles
    .map((candle, index) => {
      const x = plotLeft + step * (index + 0.5);
      const yHigh = yFor(candle.high);
      const yLow = yFor(candle.low);
      const yOpen = yFor(candle.open);
      const yClose = yFor(candle.close);
      const bullish = candle.close >= candle.open;
      const color = bullish ? "#22c55e" : "#ef4444";
      const top = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1.6);
      return `
        <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="${wickWidth}" />
        <rect x="${x - bodyWidth / 2}" y="${top}" width="${bodyWidth}" height="${bodyHeight}" fill="${color}" rx="0.5" />
      `;
    })
    .join("");

  // Lines only on chart — numeric levels are shown once in the chips section below.
  const resistanceLines = (analysis.key_resistance || [])
    .slice(0, 2)
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#ef4444" stroke-dasharray="6 4" stroke-width="1.2" opacity="0.85" />`;
    })
    .join("");

  const supportLines = (analysis.key_support || [])
    .slice(0, 2)
    .map((level) => {
      const price = parseLevel(level);
      if (price === null) return "";
      const y = yFor(price);
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#22c55e" stroke-dasharray="6 4" stroke-width="1.2" opacity="0.85" />`;
    })
    .join("");

  const last = candles[candles.length - 1];
  const lastY = yFor(last.close);
  const priceLabel = formatPrice(analysis.current_price || last.close);
  const tagY = Math.min(Math.max(lastY - 14, 8), height - 36);

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="420" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chartBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#101b31" />
          <stop offset="100%" stop-color="#0a1220" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#chartBg)" rx="18" />
      ${grid}
      ${resistanceLines}
      ${supportLines}
      ${body}
      <line x1="${plotLeft}" y1="${lastY}" x2="${plotRight}" y2="${lastY}" stroke="rgba(56,189,248,0.35)" stroke-dasharray="3 3" stroke-width="1" />
      <rect x="${plotRight + 4}" y="${tagY}" rx="8" width="78" height="28" fill="#0ea5e9" />
      <text x="${plotRight + 43}" y="${tagY + 19}" fill="#061018" font-size="13" text-anchor="middle" font-family="Vazirmatn, sans-serif" font-weight="800">${escapeHtml(priceLabel)}</text>
    </svg>
  `;
}

function renderLevelChips(items, kind) {
  if (!items?.length) {
    return `<div class="chip muted">نامشخص</div>`;
  }

  return items
    .slice(0, 3)
    .map(
      (item) => `
      <div class="chip ${kind}">${escapeHtml(formatPrice(item))}</div>`,
    )
    .join("");
}

function buildAnalysisCardHtml(analysis, candles = []) {
  const { date, time } = formatNow();
  const confidence = Number(analysis.confidence) || 0;
  const showNeutral = Number(analysis.neutral_scenario_probability) > 0;
  const longScore =
    analysis.long_score !== null && analysis.long_score !== undefined
      ? analysis.long_score
      : "-";
  const shortScore =
    analysis.short_score !== null && analysis.short_score !== undefined
      ? analysis.short_score
      : "-";

  const summary =
    analysis.summary || analysis.market_summary || analysis.final_verdict || "در حال آماده‌سازی";
  const longConfirm = analysis.long_confirm || {};
  const shortConfirm = analysis.short_confirm || {};
  const longHow = (longConfirm.how || [])
    .slice(0, 5)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const shortHow = (shortConfirm.how || [])
    .slice(0, 5)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #020617;
      color: #e8eefc;
      font-family: "Vazirmatn", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    /* Phone full-screen story: 9:16 */
    .card {
      width: 1080px;
      min-height: 1920px;
      height: auto;
      padding: 36px 34px 28px;
      background:
        radial-gradient(circle at 20% 0%, rgba(56,189,248,.14), transparent 30%),
        radial-gradient(circle at 85% 8%, rgba(34,197,94,.10), transparent 28%),
        linear-gradient(180deg, #07111f 0%, #050b16 50%, #020617 100%);
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .logo {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 28%, #ffd48a, #f7931a 60%, #c2410c);
      display: grid;
      place-items: center;
      color: #111;
      font-size: 30px;
      font-weight: 800;
    }
    .pair { font-size: 40px; font-weight: 800; line-height: 1.1; }
    .sub { margin-top: 4px; color: #93c5fd; font-size: 16px; font-weight: 700; }
    .meta-top { text-align: left; color: #94a3b8; font-size: 15px; font-weight: 600; }
    .stats {
      display: grid;
      grid-template-columns: 1.1fr 1fr 1fr;
      gap: 12px;
    }
    .panel {
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.14);
      border-radius: 20px;
      padding: 18px 18px;
    }
    .label { color: #94a3b8; font-size: 14px; font-weight: 700; margin-bottom: 8px; }
    .value-lg { font-size: 34px; font-weight: 800; line-height: 1.1; }
    .bias-bull { color: #4ade80; }
    .bias-bear { color: #f87171; }
    .bias-neutral { color: #fbbf24; }
    .conf { color: #38bdf8; }
    .price { color: #e2e8f0; }
    .score-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .score {
      border-radius: 18px;
      padding: 16px 18px;
      background: #0b1526;
      border: 1px solid rgba(148,163,184,.14);
      text-align: center;
    }
    .score.long { border-color: rgba(34,197,94,.35); }
    .score.short { border-color: rgba(239,68,68,.35); }
    .score .n { font-size: 42px; font-weight: 800; }
    .score.long .n { color: #4ade80; }
    .score.short .n { color: #f87171; }
    .section-title {
      font-size: 18px;
      font-weight: 800;
      color: #93c5fd;
      margin-bottom: 12px;
    }
    .check-row {
      display: grid;
      grid-template-columns: 1.3fr 0.9fr 1.2fr;
      gap: 8px;
      align-items: center;
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: 14px;
      background: #111827;
      border: 1px solid rgba(148,163,184,.08);
      border-inline-start: 5px solid #64748b;
      font-size: 16px;
      font-weight: 700;
    }
    .check-row.tone-bull { border-inline-start-color: #22c55e; background: rgba(34,197,94,.06); }
    .check-row.tone-bear { border-inline-start-color: #ef4444; background: rgba(239,68,68,.06); }
    .check-row.tone-neutral { border-inline-start-color: #f59e0b; background: rgba(245,158,11,.06); }
    .check-name { color: #cbd5e1; }
    .check-value { color: #e2e8f0; text-align: center; }
    .check-row.tone-bull .check-result { color: #4ade80; text-align: left; }
    .check-row.tone-bear .check-result { color: #f87171; text-align: left; }
    .check-row.tone-neutral .check-result { color: #fbbf24; text-align: left; }
    .check-empty, .chart-empty {
      color: #64748b;
      text-align: center;
      padding: 28px;
      border: 1px dashed rgba(148,163,184,.2);
      border-radius: 16px;
    }
    .summary {
      font-size: 20px;
      line-height: 1.75;
      font-weight: 700;
      color: #e2e8f0;
    }
    .levels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 18px;
      font-weight: 800;
      background: #111827;
      border: 1px solid rgba(148,163,184,.12);
    }
    .chip.resist { color: #fca5a5; border-color: rgba(239,68,68,.28); }
    .chip.support { color: #86efac; border-color: rgba(34,197,94,.28); }
    .chip.muted { color: #94a3b8; }
    .range {
      margin-top: 10px;
      color: #94a3b8;
      font-size: 16px;
      font-weight: 700;
    }
    .range strong { color: #e2e8f0; }
    .scenarios { display: grid; gap: 10px; }
    .scenario {
      border-radius: 16px;
      padding: 14px 16px;
      background: #111827;
      border: 1px solid rgba(148,163,184,.1);
      border-inline-start: 5px solid #64748b;
    }
    .scenario.tone-bull { border-inline-start-color: #22c55e; background: rgba(34,197,94,.06); }
    .scenario.tone-bear { border-inline-start-color: #ef4444; background: rgba(239,68,68,.06); }
    .scenario.tone-neutral { border-inline-start-color: #f59e0b; background: rgba(245,158,11,.06); }
    .scenario-head {
      display: flex;
      justify-content: space-between;
      font-size: 18px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .scenario.tone-bull .scenario-head { color: #4ade80; }
    .scenario.tone-bear .scenario-head { color: #f87171; }
    .scenario.tone-neutral .scenario-head { color: #fbbf24; }
    .scenario p {
      margin: 0;
      color: #cbd5e1;
      font-size: 17px;
      line-height: 1.6;
      font-weight: 600;
    }
    .confirm-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .confirm {
      border-radius: 18px;
      padding: 16px;
      background: #111827;
      border: 1px solid rgba(148,163,184,.12);
      border-inline-start: 5px solid #64748b;
    }
    .confirm.long { border-inline-start-color: #22c55e; background: rgba(34,197,94,.06); }
    .confirm.short { border-inline-start-color: #ef4444; background: rgba(239,68,68,.06); }
    .confirm h3 {
      margin: 0 0 10px;
      font-size: 18px;
      font-weight: 800;
    }
    .confirm.long h3 { color: #4ade80; }
    .confirm.short h3 { color: #f87171; }
    .confirm .zone {
      font-size: 16px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 10px;
      line-height: 1.55;
    }
    .confirm ul {
      margin: 0;
      padding: 0 18px 0 0;
      color: #cbd5e1;
      font-size: 15px;
      line-height: 1.65;
      font-weight: 600;
    }
    .confirm .inv {
      margin-top: 10px;
      color: #fbbf24;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.5;
    }
    .fill { flex: 1; min-height: 8px; }
    .disclaimer {
      border-radius: 14px;
      padding: 14px 16px;
      background: rgba(250, 204, 21, 0.08);
      border: 1px solid rgba(250, 204, 21, 0.22);
      color: #fde68a;
      font-size: 15px;
      line-height: 1.7;
      text-align: center;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card" id="analysis-card">
    <div class="top">
      <div class="brand">
        <div class="logo">₿</div>
        <div>
          <div class="pair">${escapeHtml(analysis.pair_label || analysis.symbol)}</div>
          <div class="sub">شرح تحلیل پژوهشی</div>
        </div>
      </div>
      <div class="meta-top">${escapeHtml(date)}<br>${escapeHtml(time)}</div>
    </div>

    <div class="stats">
      <div class="panel">
        <div class="label">تمایل بازار</div>
        <div class="value-lg ${biasClass(analysis.bias)}">${escapeHtml(analysis.bias || "خنثی")}</div>
      </div>
      <div class="panel">
        <div class="label">اطمینان</div>
        <div class="value-lg conf">${escapeHtml(confidence)}%</div>
      </div>
      <div class="panel">
        <div class="label">قیمت</div>
        <div class="value-lg price">${escapeHtml(formatPrice(analysis.current_price || "-"))}</div>
      </div>
    </div>

    <div class="score-row">
      <div class="score long">
        <div class="label">امتیاز لانگ</div>
        <div class="n">${escapeHtml(longScore)}<span style="font-size:22px;color:#94a3b8">/10</span></div>
      </div>
      <div class="score short">
        <div class="label">امتیاز شورت</div>
        <div class="n">${escapeHtml(shortScore)}<span style="font-size:22px;color:#94a3b8">/10</span></div>
      </div>
    </div>

    <div class="panel">
      <div class="section-title">الان بازار چه وضعی دارد؟</div>
      <div class="summary">${escapeHtml(summary)}</div>
    </div>

    <div class="panel">
      <div class="section-title">نمودار قیمت (1H)</div>
      ${buildCandleSvg(candles, analysis)}
    </div>

    <div class="panel">
      <div class="section-title">کاربر چه کار کند؟</div>
      <div class="summary">${escapeHtml(
        analysis.trading_suggestion || analysis.short_term_strategy || summary,
      )}</div>
    </div>

    <div class="panel">
      <div class="section-title">سطوح کلیدی</div>
      <div class="levels">
        <div>
          <div class="label">مقاومت‌ها</div>
          <div class="chips">${renderLevelChips(analysis.key_resistance, "resist")}</div>
        </div>
        <div>
          <div class="label">حمایت‌ها</div>
          <div class="chips">${renderLevelChips(analysis.key_support, "support")}</div>
        </div>
      </div>
      <div class="range">محدوده: <strong>${escapeHtml(analysis.current_range || "نامشخص")}</strong></div>
    </div>

    <div class="panel">
      <div class="section-title">سناریوها</div>
      <div class="scenarios">
        <div class="scenario tone-bull">
          <div class="scenario-head"><span>صعودی</span><span>${escapeHtml(analysis.bullish_scenario_probability || 0)}%</span></div>
          <p>${escapeHtml(analysis.bullish_scenario || "نامشخص")}</p>
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
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="section-title">چطور سناریوها تأیید می‌شوند؟</div>
      <div class="confirm-grid">
        <div class="confirm long">
          <h3>لانگ کی تأیید می‌شود؟</h3>
          <div class="zone">کجا: ${escapeHtml(longConfirm.zone || "نامشخص")}</div>
          <ul>${longHow || "<li>شرط تأیید مشخص نشده</li>"}</ul>
          ${
            longConfirm.invalidation
              ? `<div class="inv">باطل: ${escapeHtml(longConfirm.invalidation)}</div>`
              : ""
          }
        </div>
        <div class="confirm short">
          <h3>شورت کی تأیید می‌شود؟</h3>
          <div class="zone">کجا: ${escapeHtml(shortConfirm.zone || "نامشخص")}</div>
          <ul>${shortHow || "<li>شرط تأیید مشخص نشده</li>"}</ul>
          ${
            shortConfirm.invalidation
              ? `<div class="inv">باطل: ${escapeHtml(shortConfirm.invalidation)}</div>`
              : ""
          }
        </div>
      </div>
    </div>

    <div class="fill"></div>
    <div class="disclaimer">
      دستور خرید/فروش نیست؛ فقط شرایط تأیید سناریوی لانگ/شورت برای مدیریت ریسک.
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildAnalysisCardHtml,
};
