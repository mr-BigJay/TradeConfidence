const assert = require("node:assert/strict");
const {
  buildFuturesUrls,
  formatCoinExFuturesSymbol,
  trimNonResearchText,
} = require("../playwright/scraper");

assert.equal(formatCoinExFuturesSymbol("BTCUSDT"), "BTC-USDT");
const urls = buildFuturesUrls("BTCUSDT");
assert.ok(urls.some((url) => /\/en\/futures\/btc-usdt$/i.test(url)));
assert.ok(urls.some((url) => /\/futures\/BTC-USDT/.test(url)));

const sample = trimNonResearchText(`
Noise Order Book
AI Research
BTC Short-Term Consolidation
Market News
Something important about BTC support at 64000.
Strategic Analysis
Bullish recovery if resistance breaks.
Futures Trading
Place Order
`);
assert.match(sample, /Market News|Strategic Analysis|Short-Term/i);
assert.ok(!/Place Order/.test(sample));

console.log("coinex scraper helper tests passed");
