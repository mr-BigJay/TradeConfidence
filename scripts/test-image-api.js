#!/usr/bin/env node
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { generateAnalysisCardWithApi } = require("../services/cardImageApi");

async function main() {
  const sample = {
    symbol: "BTCUSDT",
    pair_label: "BTC / USDT",
    bias: "خنثی",
    confidence: 72,
    current_price: "65980",
    current_range: "65600-66300",
    structure: "خنثی",
    volume_status: "ضعیف",
    momentum_status: "ضعیف",
    key_resistance: ["66100", "66300"],
    key_support: ["65600", "63820", "63760"],
    insights: [
      { title: "ETF", text: "ورود سرمایه نهادی ادامه دارد", tone: "bullish" },
      { title: "ژئوپلیتیک", text: "ریسک کوتاه‌مدت بالاست", tone: "bearish" },
      { title: "حجم", text: "حجم معاملات کاهش یافته", tone: "neutral" },
      { title: "روند", text: "بلندمدت هنوز صعودی است", tone: "bullish" },
    ],
    bullish_scenario: "شکست مقاومت با حجم",
    bullish_scenario_probability: 40,
    bullish_targets: ["66800", "67500"],
    neutral_scenario: "نوسان در محدوده",
    neutral_scenario_probability: 45,
    bearish_scenario: "از دست رفتن حمایت",
    bearish_scenario_probability: 15,
    bearish_targets: ["65000", "64300"],
    indicators: [
      { name: "MACD 1D", status: "صعودی", tone: "bullish" },
      { name: "MACD 1H", status: "نزولی", tone: "bearish" },
      { name: "حجم", status: "ضعیف", tone: "neutral" },
    ],
    long_term_strategy: "حفظ ساختار تا وقتی حمایت اصلی سالم است",
    short_term_strategy: "منتظر شکست محدوده",
    long_term_trend: "صعودی",
    short_term_trend: "نوسانی",
    bullish_probability: 72,
    bearish_probability: 28,
    correction_probability: 28,
  };

  console.log("IMAGE_BASE_URL=", process.env.IMAGE_BASE_URL || "(missing)");
  console.log("IMAGE_MODEL=", process.env.IMAGE_MODEL || "(missing)");
  console.log("CARD_MODE=", process.env.CARD_MODE || "(missing)");

  const filePath = await generateAnalysisCardWithApi(sample);
  console.log("OK:", filePath);
  console.log("Size:", fs.statSync(path.resolve(filePath)).size, "bytes");
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
