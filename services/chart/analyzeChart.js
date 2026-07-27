/**
 * Chart Intelligence Layer
 * Multi-timeframe structure, S/R, indicators, volume, patterns, fibonacci, liquidity.
 * Pattern alone never creates a trade; setup requires market + technical + risk confirmations.
 */

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function emaSeries(values, period) {
  const out = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      if (i + 1 < period) {
        out.push(null);
        continue;
      }
      const seed = values.slice(i + 1 - period, i + 1);
      prev = seed.reduce((a, b) => a + b, 0) / period;
      out.push(prev);
      continue;
    }
    prev = value * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function findSwings(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const high = candles[i].high;
    const low = candles[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= high) isHigh = false;
      if (candles[j].low <= low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: high, time: candles[i].time });
    if (isLow) lows.push({ index: i, price: low, time: candles[i].time });
  }
  return { highs, lows };
}

function detectStructure(candles) {
  const { highs, lows } = findSwings(candles, 3, 3);
  const lastHighs = highs.slice(-3);
  const lastLows = lows.slice(-3);

  let structure = "Range Market";
  let detail = "insufficient swings";

  if (lastHighs.length >= 2 && lastLows.length >= 2) {
    const hh = lastHighs[lastHighs.length - 1].price > lastHighs[lastHighs.length - 2].price;
    const hl = lastLows[lastLows.length - 1].price > lastLows[lastLows.length - 2].price;
    const lh = lastHighs[lastHighs.length - 1].price < lastHighs[lastHighs.length - 2].price;
    const ll = lastLows[lastLows.length - 1].price < lastLows[lastLows.length - 2].price;

    if (hh && hl) {
      structure = "Bullish Structure";
      detail = "Higher High + Higher Low";
    } else if (lh && ll) {
      structure = "Bearish Structure";
      detail = "Lower High + Lower Low";
    } else if ((hh && ll) || (lh && hl)) {
      structure = "Market Transition";
      detail = "Mixed swing sequence";
    } else {
      structure = "Range Market";
      detail = "Sideways swings";
    }
  }

  return {
    structure,
    detail,
    swingHigh: lastHighs[lastHighs.length - 1]?.price ?? null,
    swingLow: lastLows[lastLows.length - 1]?.price ?? null,
    recentHighs: lastHighs.map((item) => round(item.price, 1)),
    recentLows: lastLows.map((item) => round(item.price, 1)),
  };
}

function computeVwap(candles, lookback = 48) {
  const slice = candles.slice(-lookback);
  let pv = 0;
  let vol = 0;
  for (const candle of slice) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume || 0;
    pv += typical * volume;
    vol += volume;
  }
  return vol > 0 ? pv / vol : null;
}

function detectSupportsResistances(candles, structure) {
  if (!candles.length) {
    return {
      majorSupport: [],
      minorSupport: [],
      majorResistance: [],
      minorResistance: [],
      vwap: null,
      dailyHigh: null,
      dailyLow: null,
    };
  }

  const last = candles[candles.length - 1];
  const day = candles.slice(-24);
  const week = candles.slice(-24 * 7);
  const dailyHigh = Math.max(...day.map((c) => c.high));
  const dailyLow = Math.min(...day.map((c) => c.low));
  const weeklyHigh = Math.max(...week.map((c) => c.high));
  const weeklyLow = Math.min(...week.map((c) => c.low));
  const vwap = computeVwap(candles, Math.min(48, candles.length));
  const price = last.close;

  const candidates = [
    structure.swingLow,
    structure.swingHigh,
    dailyHigh,
    dailyLow,
    weeklyHigh,
    weeklyLow,
    vwap,
    ...(structure.recentLows || []),
    ...(structure.recentHighs || []),
  ]
    .filter((value) => Number.isFinite(value))
    .map((value) => round(value, 1));

  const unique = [...new Set(candidates)].sort((a, b) => a - b);
  const supports = unique.filter((level) => level < price);
  const resistances = unique.filter((level) => level > price);

  return {
    majorSupport: supports.slice(-2).reverse(),
    minorSupport: supports.slice(-4, -2).reverse(),
    majorResistance: resistances.slice(0, 2),
    minorResistance: resistances.slice(2, 4),
    vwap: round(vwap, 1),
    dailyHigh: round(dailyHigh, 1),
    dailyLow: round(dailyLow, 1),
    weeklyHigh: round(weeklyHigh, 1),
    weeklyLow: round(weeklyLow, 1),
  };
}

function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema100 = emaSeries(closes, 100);
  const ema200 = emaSeries(closes, 200);
  const e20 = ema20[ema20.length - 1];
  const e50 = ema50[ema50.length - 1];
  const e100 = ema100[ema100.length - 1];
  const e200 = ema200[ema200.length - 1];
  const e20Prev = ema20[ema20.length - 5];
  const e50Prev = ema50[ema50.length - 5];

  let trend = "Neutral";
  if (last && e20 && e50 && last > e20 && e20 > e50) trend = "Bullish";
  if (last && e20 && e50 && last < e20 && e20 < e50) trend = "Bearish";

  const cross =
    e20 !== null && e50 !== null && e20Prev !== null && e50Prev !== null
      ? e20Prev <= e50Prev && e20 > e50
        ? "bullish_cross"
        : e20Prev >= e50Prev && e20 < e50
          ? "bearish_cross"
          : "none"
      : "none";

  // RSI
  let rsi = null;
  if (closes.length > 15) {
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - 14; i < closes.length; i += 1) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }

  // MACD
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? ema12[i] - ema26[i] : null,
  );
  const signal = emaSeries(
    macdLine.map((v) => (v === null ? 0 : v)),
    9,
  );
  const macd = macdLine[macdLine.length - 1];
  const macdSignal = signal[signal.length - 1];
  const hist = macd !== null && macdSignal !== null ? macd - macdSignal : null;

  // Stoch RSI proxy
  let stochRsi = null;
  if (rsi !== null) {
    const rsiSeries = [];
    for (let i = 15; i < closes.length; i += 1) {
      let g = 0;
      let l = 0;
      for (let j = i - 13; j <= i; j += 1) {
        const d = closes[j] - closes[j - 1];
        if (d >= 0) g += d;
        else l -= d;
      }
      rsiSeries.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
    }
    const window = rsiSeries.slice(-14);
    const min = Math.min(...window);
    const max = Math.max(...window);
    stochRsi = max === min ? 50 : ((rsiSeries[rsiSeries.length - 1] - min) / (max - min)) * 100;
  }

  const vwap = computeVwap(candles, Math.min(48, candles.length));

  return {
    ema20: round(e20, 1),
    ema50: round(e50, 1),
    ema100: round(e100, 1),
    ema200: round(e200, 1),
    priceVsEma:
      last && e20
        ? last > e20
          ? "above_ema20"
          : "below_ema20"
        : "unknown",
    trend,
    emaCross: cross,
    emaSlope:
      e20 !== null && e20Prev !== null ? (e20 > e20Prev ? "up" : e20 < e20Prev ? "down" : "flat") : "unknown",
    vwap: round(vwap, 1),
    fairValueBias:
      last && vwap ? (last > vwap ? "above_vwap" : last < vwap ? "below_vwap" : "at_vwap") : "unknown",
    rsi: round(rsi, 2),
    rsiState: rsi === null ? "unknown" : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral",
    macd: {
      macd: round(macd, 2),
      signal: round(macdSignal, 2),
      histogram: round(hist, 2),
      bias: hist === null ? "unknown" : hist >= 0 ? "bullish" : "bearish",
    },
    stochRsi: round(stochRsi, 2),
    stochState:
      stochRsi === null ? "unknown" : stochRsi >= 80 ? "overbought" : stochRsi <= 20 ? "oversold" : "neutral",
  };
}

function analyzeVolume(candles) {
  if (candles.length < 20) {
    return { state: "unknown", note: "insufficient candles" };
  }
  const volumes = candles.map((c) => c.volume || 0);
  const avg = sma(volumes, 20);
  const last = volumes[volumes.length - 1];
  const prev = volumes[volumes.length - 2];
  const lastClose = candles[candles.length - 1].close;
  const prevClose = candles[candles.length - 2].close;
  const priceUp = lastClose > prevClose;
  const volUp = last > avg;

  let state = "normal";
  if (last > avg * 1.5) state = "volume_expansion";
  else if (last < avg * 0.6) state = "volume_decline";

  let confirmation = "neutral";
  if (priceUp && volUp) confirmation = "trend_confirmed";
  if (priceUp && !volUp) confirmation = "weak_rally";
  if (!priceUp && volUp) confirmation = "sell_pressure";
  if (!priceUp && !volUp) confirmation = "quiet_decline";

  const priceChange = lastClose - prevClose;
  const volChange = last - prev;
  const divergence =
    (priceChange > 0 && volChange < 0) || (priceChange < 0 && volChange > 0)
      ? "volume_divergence"
      : "none";

  return {
    state,
    confirmation,
    divergence,
    lastVolume: round(last, 2),
    avgVolume20: round(avg, 2),
    breakoutVolume: last > avg * 1.8,
  };
}

function detectPatterns(candles, timeframe) {
  const patterns = [];
  if (candles.length < 40) return patterns;

  const { highs, lows } = findSwings(candles, 2, 2);
  const lastHighs = highs.slice(-4);
  const lastLows = lows.slice(-4);
  const last = candles[candles.length - 1].close;

  // Double top / bottom
  if (lastHighs.length >= 2) {
    const a = lastHighs[lastHighs.length - 2];
    const b = lastHighs[lastHighs.length - 1];
    const diff = Math.abs(a.price - b.price) / a.price;
    if (diff < 0.008) {
      const neck = Math.min(...candles.slice(a.index, b.index + 1).map((c) => c.low));
      patterns.push({
        name: "Double Top",
        timeframe,
        confidence: 70,
        breakout_level: round(neck, 1),
        target_price: round(neck - (a.price - neck), 1),
        invalidation_level: round(Math.max(a.price, b.price), 1),
      });
    }
  }
  if (lastLows.length >= 2) {
    const a = lastLows[lastLows.length - 2];
    const b = lastLows[lastLows.length - 1];
    const diff = Math.abs(a.price - b.price) / a.price;
    if (diff < 0.008) {
      const neck = Math.max(...candles.slice(a.index, b.index + 1).map((c) => c.high));
      patterns.push({
        name: "Double Bottom",
        timeframe,
        confidence: 72,
        breakout_level: round(neck, 1),
        target_price: round(neck + (neck - a.price), 1),
        invalidation_level: round(Math.min(a.price, b.price), 1),
      });
    }
  }

  // Flag / triangle approximations using compression of recent range
  const window = candles.slice(-20);
  const rangeNow = Math.max(...window.slice(-8).map((c) => c.high)) - Math.min(...window.slice(-8).map((c) => c.low));
  const rangePrev = Math.max(...window.slice(0, 8).map((c) => c.high)) - Math.min(...window.slice(0, 8).map((c) => c.low));
  const trendMove = window[window.length - 1].close - window[0].close;
  if (rangePrev > 0 && rangeNow / rangePrev < 0.55) {
    if (trendMove > 0) {
      const breakout = Math.max(...window.map((c) => c.high));
      patterns.push({
        name: "Bull Flag",
        timeframe,
        confidence: 68,
        breakout_level: round(breakout, 1),
        target_price: round(breakout + rangePrev, 1),
        invalidation_level: round(Math.min(...window.map((c) => c.low)), 1),
      });
    } else if (trendMove < 0) {
      const breakout = Math.min(...window.map((c) => c.low));
      patterns.push({
        name: "Bear Flag",
        timeframe,
        confidence: 68,
        breakout_level: round(breakout, 1),
        target_price: round(breakout - rangePrev, 1),
        invalidation_level: round(Math.max(...window.map((c) => c.high)), 1),
      });
    } else {
      patterns.push({
        name: "Triangle",
        timeframe,
        confidence: 60,
        breakout_level: round(last, 1),
        target_price: round(last + rangePrev * 0.5, 1),
        invalidation_level: round(last - rangePrev * 0.5, 1),
      });
    }
  }

  // Ascending / descending triangle: flat boundary + rising/falling opposite side
  if (lastHighs.length >= 3 && lastLows.length >= 3) {
    const highsFlat =
      Math.abs(lastHighs[lastHighs.length - 1].price - lastHighs[lastHighs.length - 3].price) /
        lastHighs[lastHighs.length - 1].price <
      0.006;
    const lowsRising =
      lastLows[lastLows.length - 1].price > lastLows[lastLows.length - 3].price * 1.002;
    const lowsFlat =
      Math.abs(lastLows[lastLows.length - 1].price - lastLows[lastLows.length - 3].price) /
        lastLows[lastLows.length - 1].price <
      0.006;
    const highsFalling =
      lastHighs[lastHighs.length - 1].price < lastHighs[lastHighs.length - 3].price * 0.998;

    if (highsFlat && lowsRising) {
      const breakout = lastHighs[lastHighs.length - 1].price;
      patterns.push({
        name: "Ascending Triangle",
        timeframe,
        confidence: 70,
        breakout_level: round(breakout, 1),
        target_price: round(breakout + (breakout - lastLows[lastLows.length - 3].price), 1),
        invalidation_level: round(lastLows[lastLows.length - 1].price, 1),
      });
    } else if (lowsFlat && highsFalling) {
      const breakout = lastLows[lastLows.length - 1].price;
      patterns.push({
        name: "Descending Triangle",
        timeframe,
        confidence: 70,
        breakout_level: round(breakout, 1),
        target_price: round(breakout - (lastHighs[lastHighs.length - 3].price - breakout), 1),
        invalidation_level: round(lastHighs[lastHighs.length - 1].price, 1),
      });
    }
  }

  // Rising/falling wedge via slope of highs/lows
  if (lastHighs.length >= 3 && lastLows.length >= 3) {
    const highSlope = lastHighs[lastHighs.length - 1].price - lastHighs[lastHighs.length - 3].price;
    const lowSlope = lastLows[lastLows.length - 1].price - lastLows[lastLows.length - 3].price;
    if (highSlope > 0 && lowSlope > 0 && highSlope < lowSlope * 0.7) {
      patterns.push({
        name: "Rising Wedge",
        timeframe,
        confidence: 64,
        breakout_level: round(lastLows[lastLows.length - 1].price, 1),
        target_price: round(last - Math.abs(highSlope), 1),
        invalidation_level: round(lastHighs[lastHighs.length - 1].price, 1),
      });
    }
    if (highSlope < 0 && lowSlope < 0 && Math.abs(lowSlope) < Math.abs(highSlope) * 0.7) {
      patterns.push({
        name: "Falling Wedge",
        timeframe,
        confidence: 64,
        breakout_level: round(lastHighs[lastHighs.length - 1].price, 1),
        target_price: round(last + Math.abs(lowSlope), 1),
        invalidation_level: round(lastLows[lastLows.length - 1].price, 1),
      });
    }
  }

  // Head & shoulders: 3 highs with middle highest
  if (lastHighs.length >= 3) {
    const [x, y, z] = lastHighs.slice(-3);
    if (y.price > x.price && y.price > z.price && Math.abs(x.price - z.price) / y.price < 0.015) {
      const neck = Math.min(...candles.slice(x.index, z.index + 1).map((c) => c.low));
      patterns.push({
        name: "Head and Shoulders",
        timeframe,
        confidence: 66,
        breakout_level: round(neck, 1),
        target_price: round(neck - (y.price - neck), 1),
        invalidation_level: round(y.price, 1),
      });
    }
  }

  // Inverse head & shoulders: 3 lows with middle lowest
  if (lastLows.length >= 3) {
    const [x, y, z] = lastLows.slice(-3);
    if (y.price < x.price && y.price < z.price && Math.abs(x.price - z.price) / Math.abs(y.price) < 0.015) {
      const neck = Math.max(...candles.slice(x.index, z.index + 1).map((c) => c.high));
      patterns.push({
        name: "Inverse Head and Shoulders",
        timeframe,
        confidence: 66,
        breakout_level: round(neck, 1),
        target_price: round(neck + (neck - y.price), 1),
        invalidation_level: round(y.price, 1),
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function computeFibonacci(candles) {
  const { highs, lows } = findSwings(candles, 3, 3);
  let swingHigh = highs[highs.length - 1];
  let swingLow = lows[lows.length - 1];

  // Fallback: use recent window extremes when swing pivots are sparse.
  if (!swingHigh || !swingLow) {
    const window = candles.slice(-60);
    if (window.length < 10) return { available: false, levels: {} };
    let highIdx = 0;
    let lowIdx = 0;
    for (let i = 1; i < window.length; i += 1) {
      if (window[i].high > window[highIdx].high) highIdx = i;
      if (window[i].low < window[lowIdx].low) lowIdx = i;
    }
    swingHigh = { index: highIdx, price: window[highIdx].high };
    swingLow = { index: lowIdx, price: window[lowIdx].low };
  }

  const upMove = swingHigh.index > swingLow.index;
  const high = Math.max(swingHigh.price, swingLow.price);
  const low = Math.min(swingHigh.price, swingLow.price);
  const range = high - low;
  if (range <= 0) return { available: false, levels: {} };

  const levels = {
    0: round(upMove ? high : low, 1),
    0.236: round(upMove ? high - range * 0.236 : low + range * 0.236, 1),
    0.382: round(upMove ? high - range * 0.382 : low + range * 0.382, 1),
    0.5: round(upMove ? high - range * 0.5 : low + range * 0.5, 1),
    0.618: round(upMove ? high - range * 0.618 : low + range * 0.618, 1),
    0.786: round(upMove ? high - range * 0.786 : low + range * 0.786, 1),
    1: round(upMove ? low : high, 1),
  };

  return {
    available: true,
    direction: upMove ? "retracement_of_up_move" : "retracement_of_down_move",
    swingHigh: round(high, 1),
    swingLow: round(low, 1),
    levels,
  };
}

function analyzeLiquidity(candles, levels, futuresContext = {}) {
  if (!candles.length) {
    return { state: "unknown", notes: [] };
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const notes = [];
  let state = "neutral";

  const sweptLow =
    levels.majorSupport?.[0] &&
    prev.low < levels.majorSupport[0] &&
    last.close > levels.majorSupport[0];
  const sweptHigh =
    levels.majorResistance?.[0] &&
    prev.high > levels.majorResistance[0] &&
    last.close < levels.majorResistance[0];

  if (sweptLow) {
    state = "liquidity_sweep_low";
    notes.push("احتمال شکار استاپ زیر حمایت و برگشت به داخل رنج");
  }
  if (sweptHigh) {
    state = "liquidity_sweep_high";
    notes.push("احتمال شکار استاپ بالای مقاومت و برگشت به داخل رنج");
  }

  const book = futuresContext.orderBook || {};
  if (book.bias === "bid_heavy") notes.push("عمق خرید در اردربوک قوی‌تر است");
  if (book.bias === "ask_heavy") notes.push("عمق فروش در اردربوک قوی‌تر است");
  if (futuresContext.cvd?.bias === "buy_pressure") notes.push("CVD با فشار خرید هم‌راستا است");
  if (futuresContext.cvd?.bias === "sell_pressure") notes.push("CVD با فشار فروش هم‌راستا است");

  const fakeBreakout =
    (sweptHigh && futuresContext.cvd?.bias !== "buy_pressure") ||
    (sweptLow && futuresContext.cvd?.bias !== "sell_pressure");
  if (fakeBreakout) notes.push("ریسک شکست جعلی وجود دارد");

  return {
    state,
    fake_breakout_risk: Boolean(fakeBreakout),
    stop_hunt_area: sweptLow ? levels.majorSupport?.[0] : sweptHigh ? levels.majorResistance?.[0] : null,
    notes,
  };
}

function buildChartSetup({ htf, ltf, futuresContext = {} }) {
  const marketConfirmation = {
    funding: futuresContext.fundingRatePercent ?? null,
    oiTrend: futuresContext.openInterest?.trend ?? null,
    cvd: futuresContext.cvd?.bias ?? null,
    volume: ltf.volume?.confirmation ?? null,
    passed: false,
    reasons: [],
  };

  if (futuresContext.cvd?.bias === "buy_pressure" || futuresContext.cvd?.bias === "sell_pressure") {
    marketConfirmation.reasons.push(`CVD=${futuresContext.cvd.bias}`);
  }
  if (futuresContext.openInterest?.trend && futuresContext.openInterest.trend !== "flat") {
    marketConfirmation.reasons.push(`OI=${futuresContext.openInterest.trend}`);
  }
  if (ltf.volume?.confirmation === "trend_confirmed" || ltf.volume?.breakoutVolume) {
    marketConfirmation.reasons.push(`Volume=${ltf.volume.confirmation}`);
  }
  if (Math.abs(futuresContext.fundingRatePercent ?? 0) < 0.08) {
    marketConfirmation.reasons.push("Funding not extreme");
  }
  marketConfirmation.passed = marketConfirmation.reasons.length >= 2;

  const technicalConfirmation = {
    structure: htf.structure?.structure ?? null,
    trend: htf.indicators?.trend ?? null,
    pattern: ltf.patterns?.[0]?.name || htf.patterns?.[0]?.name || null,
    supportReaction: null,
    passed: false,
    reasons: [],
  };

  if (/Bullish/i.test(htf.structure?.structure || "")) technicalConfirmation.reasons.push("HTF bullish structure");
  if (/Bearish/i.test(htf.structure?.structure || "")) technicalConfirmation.reasons.push("HTF bearish structure");
  if (htf.indicators?.trend === "Bullish" || htf.indicators?.trend === "Bearish") {
    technicalConfirmation.reasons.push(`HTF trend=${htf.indicators.trend}`);
  }
  if (ltf.patterns?.[0]) technicalConfirmation.reasons.push(`Pattern=${ltf.patterns[0].name}`);
  if (ltf.indicators?.rsiState === "oversold" || ltf.indicators?.rsiState === "overbought") {
    technicalConfirmation.reasons.push(`RSI=${ltf.indicators.rsiState}`);
  }
  technicalConfirmation.passed = technicalConfirmation.reasons.length >= 2;

  const price = ltf.price;
  const majorSupport = htf.levels?.majorSupport?.[0] || ltf.levels?.majorSupport?.[0];
  const majorResistance = htf.levels?.majorResistance?.[0] || ltf.levels?.majorResistance?.[0];
  const fib = htf.fibonacci?.levels || {};

  let direction = "RANGE";
  if (
    /Bullish/i.test(htf.structure?.structure || "") ||
    htf.indicators?.trend === "Bullish" ||
    futuresContext.cvd?.bias === "buy_pressure"
  ) {
    direction = "LONG";
  }
  if (
    /Bearish/i.test(htf.structure?.structure || "") ||
    htf.indicators?.trend === "Bearish" ||
    futuresContext.cvd?.bias === "sell_pressure"
  ) {
    if (direction === "LONG") direction = "RANGE";
    else direction = "SHORT";
  }

  // Pattern alone cannot force direction if confirmations fail.
  const bothConfirmed = marketConfirmation.passed && technicalConfirmation.passed;
  if (!bothConfirmed) {
    direction = "RANGE";
  }

  let entry = null;
  let stopLoss = null;
  let tp1 = null;
  let tp2 = null;
  let tp3 = null;
  let riskReward = null;
  let invalidation = null;

  if (direction === "LONG") {
    const zoneLow = majorSupport || fib["0.618"] || round(price * 0.985, 1);
    const zoneHigh = fib["0.5"] || round(zoneLow * 1.004, 1);
    entry = `${round(Math.min(zoneLow, zoneHigh), 1)}-${round(Math.max(zoneLow, zoneHigh), 1)}`;
    stopLoss = round((majorSupport || zoneLow) * 0.992, 1);
    tp1 = majorResistance || fib["0.236"] || round(price * 1.01, 1);
    tp2 = round((tp1 || price) * 1.015, 1);
    tp3 = round((tp1 || price) * 1.03, 1);
    invalidation = stopLoss;
  } else if (direction === "SHORT") {
    const zoneHigh = majorResistance || fib["0.382"] || round(price * 1.015, 1);
    const zoneLow = fib["0.5"] || round(zoneHigh * 0.996, 1);
    entry = `${round(Math.min(zoneLow, zoneHigh), 1)}-${round(Math.max(zoneLow, zoneHigh), 1)}`;
    stopLoss = round((majorResistance || zoneHigh) * 1.008, 1);
    tp1 = majorSupport || fib["0.786"] || round(price * 0.99, 1);
    tp2 = round((tp1 || price) * 0.985, 1);
    tp3 = round((tp1 || price) * 0.97, 1);
    invalidation = stopLoss;
  }

  if (entry && stopLoss && tp1) {
    const entryMid = entry.includes("-")
      ? (Number(entry.split("-")[0]) + Number(entry.split("-")[1])) / 2
      : Number(entry);
    const risk = Math.abs(entryMid - stopLoss);
    const reward = Math.abs(tp1 - entryMid);
    riskReward = risk > 0 ? `1:${round(reward / risk, 2)}` : null;
  }

  const riskManagement = {
    passed: Boolean(entry && stopLoss && tp1 && riskReward),
    entry,
    stop_loss: stopLoss,
    tp1,
    tp2,
    tp3,
    risk_reward: riskReward,
    invalidation,
  };

  return {
    direction,
    trade_allowed: bothConfirmed && riskManagement.passed && direction !== "RANGE",
    market_confirmation: marketConfirmation,
    technical_confirmation: technicalConfirmation,
    risk_management: riskManagement,
    rule: "Pattern alone never creates a trade. Need Market + Technical + Risk confirmations.",
  };
}

function analyzeTimeframe(candles, timeframe) {
  if (!candles?.length) {
    return {
      timeframe,
      available: false,
      price: null,
    };
  }
  const structure = detectStructure(candles);
  const levels = detectSupportsResistances(candles, structure);
  const indicators = computeIndicators(candles);
  const volume = analyzeVolume(candles);
  const patterns = detectPatterns(candles, timeframe);
  const fibonacci = computeFibonacci(candles);

  return {
    timeframe,
    available: true,
    price: round(candles[candles.length - 1].close, 1),
    structure,
    levels,
    indicators,
    volume,
    patterns,
    fibonacci,
  };
}

function analyzeChartIntelligence(candlesByTf = {}, futuresContext = {}) {
  const frames = ["1d", "4h", "1h", "15m", "5m"];
  const analyzed = {};
  for (const tf of frames) {
    analyzed[tf] = analyzeTimeframe(candlesByTf[tf] || [], tf);
  }

  const htf = {
    structure: analyzed["4h"].structure || analyzed["1d"].structure,
    indicators: analyzed["4h"].indicators || analyzed["1d"].indicators,
    levels: analyzed["4h"].levels || analyzed["1d"].levels,
    patterns: analyzed["4h"].patterns || analyzed["1d"].patterns || [],
    fibonacci: analyzed["4h"].fibonacci || analyzed["1d"].fibonacci,
    price: analyzed["4h"].price || analyzed["1d"].price,
  };
  const ltf = {
    structure: analyzed["1h"].structure || analyzed["15m"].structure,
    indicators: analyzed["15m"].indicators || analyzed["1h"].indicators || analyzed["5m"].indicators,
    levels: analyzed["1h"].levels || analyzed["15m"].levels,
    patterns: analyzed["15m"].patterns || analyzed["1h"].patterns || analyzed["5m"].patterns || [],
    volume: analyzed["15m"].volume || analyzed["1h"].volume || analyzed["5m"].volume,
    price: analyzed["15m"].price || analyzed["1h"].price || analyzed["5m"].price || htf.price,
  };

  const liquidity = analyzeLiquidity(
    candlesByTf["15m"] || candlesByTf["1h"] || [],
    htf.levels || {},
    futuresContext,
  );
  const setup = buildChartSetup({ htf, ltf, futuresContext });

  const multiTfSummary = {
    "1d": analyzed["1d"].indicators?.trend || analyzed["1d"].structure?.structure || "n/a",
    "4h": analyzed["4h"].structure?.structure || analyzed["4h"].indicators?.trend || "n/a",
    "1h": analyzed["1h"].structure?.detail || analyzed["1h"].indicators?.trend || "n/a",
    "15m": analyzed["15m"].patterns?.[0]?.name || analyzed["15m"].indicators?.trend || "n/a",
    "5m": analyzed["5m"].indicators?.stochState || analyzed["5m"].indicators?.trend || "n/a",
  };

  const topPattern = [...(analyzed["4h"].patterns || []), ...(analyzed["1h"].patterns || [])].sort(
    (a, b) => b.confidence - a.confidence,
  )[0];

  const checklistText = [
    "Source: Chart Intelligence (Binance candles)",
    `MTF: 1D=${multiTfSummary["1d"]} | 4H=${multiTfSummary["4h"]} | 1H=${multiTfSummary["1h"]} | 15M=${multiTfSummary["15m"]} | 5M=${multiTfSummary["5m"]}`,
    `Structure: ${htf.structure?.structure || "n/a"} (${htf.structure?.detail || ""})`,
    `Major Support: ${(htf.levels?.majorSupport || []).join(", ") || "n/a"}`,
    `Major Resistance: ${(htf.levels?.majorResistance || []).join(", ") || "n/a"}`,
    `VWAP: ${htf.levels?.vwap ?? "n/a"} | Trend: ${htf.indicators?.trend || "n/a"} | RSI: ${ltf.indicators?.rsi ?? "n/a"}`,
    `MACD: ${ltf.indicators?.macd?.bias || "n/a"} | Volume: ${ltf.volume?.confirmation || "n/a"}`,
    `Top Pattern: ${topPattern ? `${topPattern.name} ${topPattern.timeframe} conf=${topPattern.confidence}` : "none"}`,
    `Fib 0.618: ${htf.fibonacci?.levels?.["0.618"] ?? "n/a"} | Liquidity: ${liquidity.state}`,
    `Setup: ${setup.direction} allowed=${setup.trade_allowed} marketOK=${setup.market_confirmation.passed} techOK=${setup.technical_confirmation.passed} riskOK=${setup.risk_management.passed}`,
    `Entry=${setup.risk_management.entry || "n/a"} SL=${setup.risk_management.stop_loss || "n/a"} TP1=${setup.risk_management.tp1 || "n/a"} RR=${setup.risk_management.risk_reward || "n/a"}`,
  ].join("\n");

  return {
    source: "chart_intelligence",
    role: "technical_chart_analysis",
    available: Object.values(analyzed).some((item) => item.available),
    multi_timeframe: multiTfSummary,
    timeframes: analyzed,
    htf,
    ltf,
    liquidity,
    top_pattern: topPattern || null,
    setup,
    checklistText,
  };
}

module.exports = {
  analyzeChartIntelligence,
  analyzeTimeframe,
  detectStructure,
  detectPatterns,
  computeFibonacci,
  buildChartSetup,
};
