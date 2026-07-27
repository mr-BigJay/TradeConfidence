const { validateCoinexAgainstMarket } = require("./validationEngine");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Weighted scoring aligned with the desk model:
 * CoinEx + Futures + Options + Technical + Pattern - Risk
 */
function scoreMarketBundle(bundle) {
  const validation = validateCoinexAgainstMarket(bundle);
  const futures = bundle.futures || {};
  const options = bundle.options || {};
  const execution = bundle.execution || {};
  const chart = bundle.chart || {};
  const setup = chart.setup || {};

  // Component scores on a 0-100-ish contribution scale used in final blend.
  let coinexScore = 0;
  if (validation.coinexClaimedBias === "bullish") coinexScore += 12;
  if (validation.coinexClaimedBias === "bearish") coinexScore -= 12;
  if (validation.status === "Confirmed") coinexScore += 8;
  if (validation.status === "Contradicted") coinexScore -= 8;
  if (validation.status === "Partially Confirmed") coinexScore += 3;

  let futuresScore = 0;
  if (futures.cvd?.bias === "buy_pressure") futuresScore += 10;
  if (futures.cvd?.bias === "sell_pressure") futuresScore -= 10;
  if (futures.openInterest?.trend === "up") futuresScore += 6;
  if (futures.openInterest?.trend === "down") futuresScore -= 4;
  if ((futures.fundingRatePercent ?? 0) < -0.02) futuresScore += 4;
  if ((futures.fundingRatePercent ?? 0) > 0.05) futuresScore -= 5;
  if ((futures.takerBuySellRatio ?? 1) > 1.1) futuresScore += 4;
  if ((futures.takerBuySellRatio ?? 1) < 0.9) futuresScore -= 4;
  if ((futures.change24hPercent ?? 0) > 1.5) futuresScore += 3;
  if ((futures.change24hPercent ?? 0) < -1.5) futuresScore -= 3;

  let optionsScore = 0;
  if ((options.putCallRatio ?? 1) > 1.15) optionsScore += 6;
  if ((options.putCallRatio ?? 1) < 0.75) optionsScore -= 4;
  if (options.dealerGammaBias === "negative_gamma_volatile") optionsScore -= 3;
  if (options.dealerGammaBias === "positive_gamma_pinning") optionsScore += 2;
  if (
    options.maxPain &&
    futures.price &&
    Math.abs((options.maxPain - futures.price) / futures.price) < 0.015
  ) {
    optionsScore += 2;
  }

  let technicalScore = 0;
  const htfTrend = chart.htf?.indicators?.trend;
  const htfStructure = chart.htf?.structure?.structure || "";
  if (htfTrend === "Bullish" || /Bullish/i.test(htfStructure)) technicalScore += 12;
  if (htfTrend === "Bearish" || /Bearish/i.test(htfStructure)) technicalScore -= 12;
  if (chart.ltf?.indicators?.macd?.bias === "bullish") technicalScore += 4;
  if (chart.ltf?.indicators?.macd?.bias === "bearish") technicalScore -= 4;
  if (chart.ltf?.volume?.confirmation === "trend_confirmed") technicalScore += 4;
  if (chart.ltf?.volume?.confirmation === "weak_rally") technicalScore -= 2;
  if (setup.technical_confirmation?.passed) technicalScore += 5;
  if (setup.market_confirmation?.passed) technicalScore += 3;

  let patternScore = 0;
  const pattern = chart.top_pattern;
  if (pattern) {
    const bullishPattern = /bull|bottom|inverse|falling wedge|ascending/i.test(pattern.name);
    const bearishPattern = /bear|top|head and shoulders|rising wedge|descending/i.test(pattern.name);
    const weight = Math.round((pattern.confidence || 50) / 10); // ~5-8
    if (bullishPattern) patternScore += Math.min(10, weight);
    if (bearishPattern) patternScore -= Math.min(10, weight);
  }

  let riskPenalty = 0;
  if (options.dealerGammaBias === "negative_gamma_volatile") riskPenalty += 4;
  if (Math.abs(futures.fundingRatePercent ?? 0) > 0.08) riskPenalty += 5;
  if (chart.liquidity?.fake_breakout_risk) riskPenalty += 3;
  if (!futures.available) riskPenalty += 6;
  if (!chart.available) riskPenalty += 4;
  if (setup.trade_allowed === false && setup.direction === "RANGE") riskPenalty += 2;

  const fundingDiv = execution.compare?.fundingDivergencePercent;
  if (fundingDiv !== null && fundingDiv !== undefined) {
    if (fundingDiv > 0.015) futuresScore -= 2;
    if (fundingDiv < -0.015) futuresScore += 2;
  }

  const net =
    coinexScore + futuresScore + optionsScore + technicalScore + patternScore - riskPenalty;

  let bias = "Neutral";
  if (net >= 12) bias = "Bullish";
  else if (net <= -12) bias = "Bearish";

  // Prefer chart setup direction only when confirmations passed.
  if (setup.trade_allowed && setup.direction === "LONG") bias = "Bullish";
  if (setup.trade_allowed && setup.direction === "SHORT") bias = "Bearish";

  const dataCoverage =
    (bundle.coinex?.available ? 1 : 0) +
    (futures.available ? 1 : 0) +
    (options.available ? 1 : 0) +
    (execution.available ? 1 : 0) +
    (chart.available ? 1 : 0);

  const confidence = clamp(
    Math.round(
      50 +
        Math.abs(net) * 0.7 +
        dataCoverage * 4 +
        (validation.status === "Confirmed" ? 6 : validation.status === "Contradicted" ? -6 : 0) +
        (setup.trade_allowed ? 5 : 0) -
        riskPenalty,
    ),
    20,
    95,
  );

  let regime = chart.htf?.structure?.structure || "Range";
  if (/Bullish Structure/i.test(regime)) regime = "Trend";
  else if (/Bearish Structure/i.test(regime)) regime = "Distribution";
  else if (/Transition/i.test(regime)) regime = "Market Transition";
  else if (futures.openInterest?.trend === "up" && Math.abs(futures.change24hPercent ?? 0) < 1) {
    regime = "Accumulation";
  } else if (/Range/i.test(regime)) regime = "Range";

  let riskLevel = "Medium";
  if (riskPenalty >= 8 || !futures.available) riskLevel = "High";
  else if (validation.status === "Confirmed" && setup.trade_allowed && riskPenalty <= 2) {
    riskLevel = "Low";
  }

  const components = {
    coinex: Number(coinexScore.toFixed(2)),
    futures: Number(futuresScore.toFixed(2)),
    options: Number(optionsScore.toFixed(2)),
    technical: Number(technicalScore.toFixed(2)),
    pattern: Number(patternScore.toFixed(2)),
    risk: Number((-riskPenalty).toFixed(2)),
  };

  let grade = "C";
  if (confidence >= 80) grade = "A";
  else if (confidence >= 65) grade = "B";
  else if (confidence >= 45) grade = "C";
  else grade = "D";

  return {
    bias,
    confidence,
    total_score: confidence,
    grade,
    market_score: confidence,
    market_regime: regime,
    risk_level: riskLevel,
    net_score: Number(net.toFixed(2)),
    components,
    validation,
    data_coverage: dataCoverage,
    chart_snapshot: chart.available
      ? {
          available: true,
          multi_timeframe: chart.multi_timeframe || {},
          htf: chart.htf || null,
          ltf: chart.ltf || null,
          top_pattern: chart.top_pattern || null,
          liquidity: chart.liquidity || null,
        }
      : { available: false },
    chart_setup: {
      direction: setup.direction || "RANGE",
      trade_allowed: Boolean(setup.trade_allowed),
      levels_ready: Boolean(setup.levels_ready || setup.risk_management?.passed),
      entry: setup.risk_management?.entry || null,
      stop_loss: setup.risk_management?.stop_loss || null,
      tp1: setup.risk_management?.tp1 || null,
      tp2: setup.risk_management?.tp2 || null,
      tp3: setup.risk_management?.tp3 || null,
      risk_reward: setup.risk_management?.risk_reward || null,
      invalidation: setup.risk_management?.invalidation || null,
      market_confirmation: setup.market_confirmation?.passed || false,
      technical_confirmation: setup.technical_confirmation?.passed || false,
      risk_confirmation: setup.risk_management?.passed || false,
      reason: setup.rule || null,
    },
  };
}

module.exports = {
  scoreMarketBundle,
};
