function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values, period) {
  const out = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      if (i + 1 < period) {
        out.push(null);
        continue;
      }
      const seed = values.slice(i + 1 - period, i + 1);
      if (seed.some((v) => v === null)) {
        out.push(null);
        continue;
      }
      prev = seed.reduce((a, b) => a + b, 0) / period;
      out.push(prev);
      continue;
    }
    prev = value * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function computeMacd(closes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? ema12[i] - ema26[i] : null,
  );
  const validMacd = macdLine.filter((v) => v !== null);
  const signalSeries = emaSeries(
    macdLine.map((v) => (v === null ? 0 : v)),
    9,
  );
  const macd = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  if (macd === null || signal === null || validMacd.length < 9) {
    return { macd: null, signal: null, histogram: null, bias: "نامشخص" };
  }
  const histogram = macd - signal;
  return {
    macd: Number(macd.toFixed(2)),
    signal: Number(signal.toFixed(2)),
    histogram: Number(histogram.toFixed(2)),
    bias: histogram >= 0 ? "صعودی/مثبت" : "نزولی/منفی",
  };
}

function computeBollinger(closes, period = 20) {
  if (closes.length < period) {
    return { mid: null, upper: null, lower: null };
  }
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return {
    mid: Number(mid.toFixed(2)),
    upper: Number((mid + 2 * std).toFixed(2)),
    lower: Number((mid - 2 * std).toFixed(2)),
  };
}

function computeKdj(candles, period = 9) {
  if (candles.length < period) {
    return { k: null, d: null, j: null, bias: "نامشخص" };
  }

  const rsvSeries = [];
  for (let i = period - 1; i < candles.length; i += 1) {
    const slice = candles.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    const close = slice[slice.length - 1].close;
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;
    rsvSeries.push(rsv);
  }

  let k = 50;
  let d = 50;
  for (const rsv of rsvSeries) {
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }
  const j = 3 * k - 2 * d;
  let bias = "خنثی";
  if (k >= 80) bias = "اشباع خرید";
  else if (k <= 20) bias = "اشباع فروش";

  return {
    k: Number(k.toFixed(2)),
    d: Number(d.toFixed(2)),
    j: Number(j.toFixed(2)),
    bias,
  };
}

function summarizeIndicators(candles = []) {
  const closes = candles.map((c) => toNumber(c.close)).filter((v) => v !== null);
  const last = closes[closes.length - 1] ?? null;
  const ma7 = sma(closes, 7);
  const ma25 = sma(closes, 25);
  const ma99 = sma(closes, 99);
  const rsi = computeRsi(closes, 14);
  const macd = computeMacd(closes);
  const bollinger = computeBollinger(closes, 20);
  const kdj = computeKdj(candles, 9);

  let maBias = "نامشخص";
  if (last !== null && ma7 !== null && ma25 !== null) {
    if (last > ma7 && ma7 > ma25) maBias = "صعودی";
    else if (last < ma7 && ma7 < ma25) maBias = "نزولی";
    else maBias = "مخلوط/خنثی";
  }

  return {
    lastPrice: last,
    movingAverages: {
      ma7: ma7 === null ? null : Number(ma7.toFixed(2)),
      ma25: ma25 === null ? null : Number(ma25.toFixed(2)),
      ma99: ma99 === null ? null : Number(ma99.toFixed(2)),
      bias: maBias,
      deathCross: ma7 !== null && ma25 !== null ? ma7 < ma25 : null,
    },
    rsi: {
      value: rsi,
      bias: rsi === null ? "نامشخص" : rsi >= 70 ? "اشباع خرید" : rsi <= 30 ? "اشباع فروش" : "خنثی",
    },
    macd,
    bollinger: {
      ...bollinger,
      position:
        last === null || bollinger.mid === null
          ? "نامشخص"
          : last > bollinger.mid
            ? "بالای mid"
            : "زیر mid",
    },
    kdj,
  };
}

function indicatorsToText(indicators) {
  if (!indicators) return "Indicators unavailable";
  const ma = indicators.movingAverages || {};
  const rsi = indicators.rsi || {};
  const macd = indicators.macd || {};
  const bb = indicators.bollinger || {};
  const kdj = indicators.kdj || {};
  return [
    `MA7=${ma.ma7 ?? "n/a"} MA25=${ma.ma25 ?? "n/a"} MA99=${ma.ma99 ?? "n/a"} bias=${ma.bias} deathCross=${ma.deathCross}`,
    `RSI14=${rsi.value ?? "n/a"} (${rsi.bias})`,
    `MACD=${macd.macd ?? "n/a"} signal=${macd.signal ?? "n/a"} hist=${macd.histogram ?? "n/a"} (${macd.bias})`,
    `Bollinger mid=${bb.mid ?? "n/a"} upper=${bb.upper ?? "n/a"} lower=${bb.lower ?? "n/a"} position=${bb.position}`,
    `KDJ K=${kdj.k ?? "n/a"} D=${kdj.d ?? "n/a"} J=${kdj.j ?? "n/a"} (${kdj.bias})`,
  ].join("\n");
}

module.exports = {
  summarizeIndicators,
  indicatorsToText,
};
