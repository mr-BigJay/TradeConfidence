/**
 * Keep price/percent numbers consistent across GPT output, Telegram, and card.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toAsciiDigits(value) {
  return String(value ?? "").replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    if (persianIndex >= 0) return String(persianIndex);
    const arabicIndex = ARABIC_DIGITS.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    return digit;
  });
}

function extractPrices(value) {
  const text = toAsciiDigits(value)
    .replace(/[٬]/g, ",")
    .replace(/[–—−]/g, "-");

  const matches = text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || [];
  return matches
    .map((item) => Number(String(item).replace(/,/g, "")))
    .filter((num) => Number.isFinite(num));
}

/**
 * First numeric price only. Never concatenate ranges like 64800-65000.
 */
function parseLevel(value) {
  const prices = extractPrices(value);
  return prices.length ? prices[0] : null;
}

function formatInt(num) {
  return Math.round(num).toLocaleString("en-US");
}

/**
 * Normalize level text for Telegram/JSON:
 * "۶۴٬۸۰۰ – ۶۵٬۰۰۰" -> "64800-65000"
 * "64,800" -> "64800"
 */
function normalizeLevelText(value) {
  let text = toAsciiDigits(String(value ?? "").trim());
  if (!text) return "";

  text = text
    .replace(/[٬]/g, ",")
    .replace(/[–—−]/g, "-")
    .replace(/(\d),\s*(\d{3})\b/g, "$1$2")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

/**
 * Card-friendly price/range formatting without merging range sides.
 */
function formatPrice(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return raw;

  const text = normalizeLevelText(raw);
  const prices = extractPrices(text);

  if (!prices.length) {
    return toAsciiDigits(raw);
  }

  // Preserve short descriptive prefixes like "زیر 65000"
  if (/[A-Za-z\u0600-\u06FF]/.test(text)) {
    let index = 0;
    return toAsciiDigits(raw)
      .replace(/[٬]/g, ",")
      .replace(/[–—−]/g, "-")
      .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, () => {
        const price = prices[index++];
        return price === undefined ? "" : formatInt(price);
      });
  }

  if (prices.length >= 2 && text.includes("-")) {
    return `${formatInt(prices[0])}-${formatInt(prices[1])}`;
  }

  return formatInt(prices[0]);
}

function parsePercent(value, fallback = 0) {
  const ascii = toAsciiDigits(String(value ?? ""));
  const match = ascii.match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

/**
 * Clip text without cutting through a price/number token.
 */
function clipText(text, max) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= max) return value;

  let cut = max;
  const isNumChar = (ch) => /[\d,.٬]/.test(ch || "");

  // If we landed inside a number, finish the number instead of slicing it.
  if (isNumChar(value[cut - 1]) || isNumChar(value[cut])) {
    while (cut < value.length && isNumChar(value[cut])) {
      cut += 1;
    }
    // If finishing the number overshoots too far, fall back to start of the number.
    if (cut > max + 12) {
      cut = max;
      while (cut > 0 && isNumChar(value[cut - 1])) {
        cut -= 1;
      }
    }
  } else {
    const slice = value.slice(0, cut);
    const breakAt = Math.max(
      slice.lastIndexOf("۔"),
      slice.lastIndexOf("."),
      slice.lastIndexOf("؟"),
      slice.lastIndexOf("!"),
      slice.lastIndexOf("،"),
      slice.lastIndexOf(" "),
    );
    if (breakAt > max * 0.55) {
      cut = breakAt + 1;
    }
  }

  return `${value.slice(0, cut).trim()}…`;
}

module.exports = {
  toAsciiDigits,
  extractPrices,
  parseLevel,
  formatPrice,
  normalizeLevelText,
  parsePercent,
  clipText,
};
