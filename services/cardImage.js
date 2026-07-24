const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const logger = require("../logger");
const { buildAnalysisCardHtml } = require("./cardTemplate");
const { fetchFuturesKlines } = require("./marketData");

async function launchBrowser() {
  process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = "0";

  return chromium.launch({
    headless: true,
    timeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-zygote",
      "--single-process",
      "--renderer-process-limit=1",
      "--js-flags=--max-old-space-size=256",
    ],
  });
}

async function renderAnalysisCard(analysis) {
  let candles = [];
  try {
    candles = await fetchFuturesKlines(analysis.symbol, { limit: 48 });
    logger.info("Fetched klines for card chart", {
      symbol: analysis.symbol,
      candles: candles.length,
    });
  } catch (error) {
    logger.warn("Failed to fetch klines for card chart", {
      symbol: analysis.symbol,
      error: error.message,
    });
  }

  const html = buildAnalysisCardHtml(analysis, candles);
  await fs.mkdir("output", { recursive: true });
  const filePath = path.join(
    "output",
    `${analysis.symbol}-card-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 960 },
      deviceScaleFactor: 1,
    });

    await page.setContent(html, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(800);

    const card = page.locator("#analysis-card");
    await card.screenshot({
      path: filePath,
      type: "png",
    });

    logger.info("Analysis card image created", { filePath });
    return filePath;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  renderAnalysisCard,
};
