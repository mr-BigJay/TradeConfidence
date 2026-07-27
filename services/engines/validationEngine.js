/**
 * Validate CoinEx narrative against live market facts.
 */

function hasBullishLanguage(text) {
  return /bull|صعود|long|recovery|rebound|بالا|خرید/i.test(text || "");
}

function hasBearishLanguage(text) {
  return /bear|نزول|short|downtrend|افت|فروش|correction|اصلاح/i.test(text || "");
}

function scoreFunding(fundingPercent) {
  if (fundingPercent === null || fundingPercent === undefined) return 0;
  if (fundingPercent > 0.05) return -1; // crowded long
  if (fundingPercent < -0.05) return 1; // crowded short / bullish fuel
  if (fundingPercent >= 0) return 0.25;
  return -0.25;
}

function scoreOi(oi) {
  if (!oi || oi.trend === "flat") return 0;
  if (oi.trend === "up") return 0.75;
  if (oi.trend === "down") return -0.5;
  return 0;
}

function scoreCvd(cvd) {
  if (!cvd) return 0;
  if (cvd.bias === "buy_pressure") return 1;
  if (cvd.bias === "sell_pressure") return -1;
  return 0;
}

function scoreLs(ratio) {
  if (ratio === null || ratio === undefined) return 0;
  if (ratio > 1.3) return -0.5; // crowded long accounts often contrarian caution
  if (ratio < 0.8) return 0.5;
  return 0.15;
}

function scoreOptions(options) {
  let score = 0;
  if (!options?.available) return 0;
  if (options.putCallRatio !== null && options.putCallRatio > 1.1) score += 0.4; // put heavy / hedge
  if (options.putCallRatio !== null && options.putCallRatio < 0.8) score -= 0.2;
  if (options.dealerGammaBias === "negative_gamma_volatile") score -= 0.3;
  if (options.dealerGammaBias === "positive_gamma_pinning") score += 0.2;
  return score;
}

function validateCoinexAgainstMarket(bundle) {
  const text = bundle?.coinex?.text || "";
  const bullish = hasBullishLanguage(text);
  const bearish = hasBearishLanguage(text);
  const claimed =
    bullish && !bearish ? "bullish" : bearish && !bullish ? "bearish" : bullish && bearish ? "mixed" : "unclear";

  const futures = bundle.futures || {};
  const evidenceScore =
    scoreFunding(futures.fundingRatePercent) +
    scoreOi(futures.openInterest) +
    scoreCvd(futures.cvd) +
    scoreLs(futures.longShortRatio) +
    scoreOptions(bundle.options);

  let marketLean = "neutral";
  if (evidenceScore >= 1) marketLean = "bullish";
  else if (evidenceScore <= -1) marketLean = "bearish";

  let status = "Partially Confirmed";
  if (claimed === "unclear" || claimed === "mixed") {
    status = "Partially Confirmed";
  } else if (claimed === marketLean) {
    status = "Confirmed";
  } else if (marketLean === "neutral") {
    status = "Partially Confirmed";
  } else {
    status = "Contradicted";
  }

  const reasons = [];
  if (futures.available) {
    reasons.push(`Funding ${futures.fundingRatePercent ?? "n/a"}%`);
    reasons.push(`OI trend ${futures.openInterest?.trend || "n/a"}`);
    reasons.push(`CVD ${futures.cvd?.bias || "n/a"}`);
    reasons.push(`L/S ${futures.longShortRatio ?? "n/a"}`);
  } else {
    reasons.push("Binance futures data unavailable");
  }
  if (bundle.options?.available) {
    reasons.push(`PCR ${bundle.options.putCallRatio ?? "n/a"}`);
    reasons.push(`MaxPain ${bundle.options.maxPain ?? "n/a"}`);
    reasons.push(`Gamma ${bundle.options.dealerGammaBias || "n/a"}`);
  } else {
    reasons.push("Deribit options unavailable");
  }

  return {
    coinexClaimedBias: claimed,
    marketLean,
    evidenceScore: Number(evidenceScore.toFixed(2)),
    status,
    reasons,
  };
}

module.exports = {
  validateCoinexAgainstMarket,
};
