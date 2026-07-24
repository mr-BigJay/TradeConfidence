const assert = require("node:assert/strict");
const {
  toAsciiDigits,
  parseLevel,
  formatPrice,
  normalizeLevelText,
  parsePercent,
  clipText,
} = require("../services/numberFormat");
const { normalizeAnalysis } = require("../services/analysisNormalizer");

assert.equal(toAsciiDigits("۶۳۷۰۰"), "63700");
assert.equal(parseLevel("64800–65000"), 64800);
assert.equal(parseLevel("64,800 - 65,000"), 64800);
assert.notEqual(String(parseLevel("64800–65000")), "6480065000");
assert.equal(normalizeLevelText("۶۴٬۸۰۰ – ۶۵٬۰۰۰"), "64800-65000");
assert.equal(normalizeLevelText("64,800"), "64800");
assert.equal(formatPrice("64800-65000"), "64,800-65,000");
assert.equal(formatPrice("زیر 65000"), "زیر 65,000");
assert.equal(parsePercent("۷۲%"), 72);
assert.equal(parsePercent("70"), 70);

const clipped = clipText(`سطح مهم بازار روی 64800-65000 قرار دارد و بعد از آن 66400`, 35);
assert.match(clipped, /64800-65000/);
assert.doesNotMatch(clipped, /64800-6…/);

const normalized = normalizeAnalysis("BTCUSDT", {
  confidence: "۷۵٪",
  current_price: "زیر ۶۵٬۰۰۰",
  key_support: ["۶۳٬۷۰۰ – ۶۳٬۷۵۰", "62,000"],
  key_resistance: ["64800–65000", "66400"],
  current_range: "۶۳۷۰۰ – ۶۵۰۰۰",
  bearish_scenario_probability: "70%",
  bullish_targets: ["65,000", "66,400"],
});

assert.equal(normalized.confidence, 75);
assert.equal(normalized.key_support[0], "63700-63750");
assert.equal(normalized.key_resistance[0], "64800-65000");
assert.equal(normalized.current_range, "63700-65000");
assert.equal(normalized.bullish_targets[1], "66400");

console.log("number format tests passed");
