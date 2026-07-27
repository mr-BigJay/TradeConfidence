const { validateCoinexAgainstMarket } = require("./validationEngine");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Market scoring engine (exchange-agnostic inputs from normalized bundle).
 */
function scoreMarketBundle(bundle) {
  const validation = validateCoinexAgainstMarket(bundle);
  const futures = bundle.futures || {};
  const options = bundle.options || {};
  const execution = bundle.execution || {};

  let bullPoints = 0;
  let bearPoints = 0;

  // CoinEx narrative weight
  if (validation.coinexClaimedBias === "bullish") bullPoints += 2;
  if (validation.coinexClaimedBias === "bearish") bearPoints += 2;
  if (validation.status === "Confirmed") {
    if (validation.marketLean === "bullish") bullPoints += 2;
    if (validation.marketLean === "bearish") bearPoints += 2;
  } else if (validation.status === "Contradicted") {
    // penalize narrative confidence
    bullPoints -= 1;
    bearPoints -= 1;
  }

  // Futures facts
  if (futures.cvd?.bias === "buy_pressure") bullPoints += 2;
  if (futures.cvd?.bias === "sell_pressure") bearPoints += 2;
  if (futures.openInterest?.trend === "up") bullPoints += 1;
  if (futures.openInterest?.trend === "down") bearPoints += 1;
  if ((futures.fundingRatePercent ?? 0) < -0.02) bullPoints += 1;
  if ((futures.fundingRatePercent ?? 0) > 0.05) bearPoints += 1;
  if ((futures.takerBuySellRatio ?? 1) > 1.1) bullPoints += 1;
  if ((futures.takerBuySellRatio ?? 1) < 0.9) bearPoints += 1;
  if ((futures.change24hPercent ?? 0) > 1.5) bullPoints += 1;
  if ((futures.change24hPercent ?? 0) < -1.5) bearPoints += 1;

  // Options
  if ((options.putCallRatio ?? 1) > 1.15) bullPoints += 1; // hedges / fear often marks bottoms
  if ((options.putCallRatio ?? 1) < 0.75) bearPoints += 0.5;
  if (options.dealerGammaBias === "negative_gamma_volatile") {
    // volatility risk both ways; raise risk instead of hard bias
  }
  if (
    options.maxPain &&
    futures.price &&
    Math.abs((options.maxPain - futures.price) / futures.price) < 0.01
  ) {
    // pinning regime near max pain
  }

  // Execution venue divergence mild adjustments
  const fundingDiv = execution.compare?.fundingDivergencePercent;
  if (fundingDiv !== null && fundingDiv !== undefined) {
    if (fundingDiv > 0.015) bearPoints += 0.5;
    if (fundingDiv < -0.015) bullPoints += 0.5;
  }

  const net = bullPoints - bearPoints;
  let bias = "Neutral";
  if (net >= 2) bias = "Bullish";
  else if (net <= -2) bias = "Bearish";

  const magnitude = Math.abs(net);
  const dataCoverage =
    (bundle.coinex?.available ? 1 : 0) +
    (futures.available ? 1 : 0) +
    (options.available ? 1 : 0) +
    (execution.available ? 1 : 0);
  const coverageBoost = dataCoverage * 5;
  const confidence = clamp(Math.round(45 + magnitude * 8 + coverageBoost + (validation.status === "Confirmed" ? 8 : validation.status === "Contradicted" ? -8 : 0)), 20, 95);

  let regime = "Range";
  if (Math.abs(futures.change24hPercent ?? 0) > 2.5 && futures.openInterest?.trend === "up") {
    regime = bias === "Bullish" ? "Trend" : bias === "Bearish" ? "Distribution" : "Trend";
  } else if (futures.openInterest?.trend === "up" && Math.abs(futures.change24hPercent ?? 0) < 1) {
    regime = "Accumulation";
  } else if (futures.openInterest?.trend === "down") {
    regime = bias === "Bearish" ? "Distribution" : "Range";
  }
  if (options.dealerGammaBias === "positive_gamma_pinning") {
    regime = "Range";
  }

  let riskLevel = "Medium";
  if (
    options.dealerGammaBias === "negative_gamma_volatile" ||
    Math.abs(futures.fundingRatePercent ?? 0) > 0.08 ||
    !futures.available
  ) {
    riskLevel = "High";
  } else if (validation.status === "Confirmed" && magnitude >= 3) {
    riskLevel = "Low";
  }

  return {
    bias,
    confidence,
    market_score: confidence,
    market_regime: regime,
    risk_level: riskLevel,
    net_score: Number(net.toFixed(2)),
    bull_points: Number(bullPoints.toFixed(2)),
    bear_points: Number(bearPoints.toFixed(2)),
    validation,
    data_coverage: dataCoverage,
  };
}

module.exports = {
  scoreMarketBundle,
};
