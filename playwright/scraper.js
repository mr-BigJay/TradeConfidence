const { chromium } = require("playwright");
const config = require("../config/config");
const logger = require("../logger");

const EXCLUDE_AFTER_MARKERS = [
  "Futures Trading",
  "Strategic Trading",
  "Order Book",
  "Trades",
  "Futures Asset",
  "Comments",
];

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimNonResearchText(text) {
  let cleaned = normalizeText(text);

  const startMarkers = [
    /[A-Z]{2,}.*?(Short|Long|Term|Recovery|Market|Trend|AI)/i,
    /Trend/i,
    /Market News/i,
    /Strategic Analysis/i,
  ];

  const startIndexes = startMarkers
    .map((marker) => {
      const match = cleaned.match(marker);
      return match ? match.index : -1;
    })
    .filter((index) => index >= 0);

  if (startIndexes.length) {
    cleaned = cleaned.slice(Math.min(...startIndexes)).trim();
  }

  const endIndexes = EXCLUDE_AFTER_MARKERS
    .map((marker) => cleaned.indexOf(marker))
    .filter((index) => index > 80);

  if (endIndexes.length) {
    cleaned = cleaned.slice(0, Math.min(...endIndexes)).trim();
  }

  return normalizeText(cleaned);
}

async function clickAiResearchTab(page, timeoutMs) {
  const tabCandidates = [
    page.getByText("AI Research", { exact: true }),
    page.locator("text=AI Research"),
    page.locator("[role='tab']").filter({ hasText: "AI Research" }),
  ];

  for (const candidate of tabCandidates) {
    try {
      const count = await candidate.count();
      if (!count) {
        continue;
      }

      const tab = candidate.first();
      await tab.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await tab.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      return;
    } catch (error) {
      logger.debug("AI Research tab click candidate failed", { error: error.message });
    }
  }

  await page.waitForSelector("text=AI Research", { timeout: timeoutMs });
}

async function waitForResearchContent(page, timeoutMs) {
  await Promise.race([
    page.waitForSelector("text=Market News", { timeout: timeoutMs }),
    page.waitForSelector("text=Strategic Analysis", { timeout: timeoutMs }),
    page.waitForSelector("text=Short-Term", { timeout: timeoutMs }),
  ]);
}

async function extractResearchText(page) {
  const rawText = await page.evaluate(() => {
    const visibilityCache = new WeakMap();

    function isVisible(element) {
      if (visibilityCache.has(element)) {
        return visibilityCache.get(element);
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible =
        style &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0;

      visibilityCache.set(element, visible);
      return visible;
    }

    function scoreText(text) {
      let score = 0;
      const checks = [
        ["AI Research", 5],
        ["Trend", 10],
        ["Market News", 20],
        ["Strategic Analysis", 20],
        ["Short-term", 10],
        ["Long-term", 10],
        ["sources", 5],
      ];

      for (const [marker, weight] of checks) {
        if (text.toLowerCase().includes(marker.toLowerCase())) {
          score += weight;
        }
      }

      if (text.includes("Order Book")) {
        score -= 15;
      }

      if (text.includes("Trades")) {
        score -= 10;
      }

      return score + Math.min(text.length / 500, 20);
    }

    const candidates = Array.from(document.querySelectorAll("main, section, article, div"))
      .filter(isVisible)
      .map((element) => ({
        text: element.innerText || "",
        score: scoreText(element.innerText || ""),
      }))
      .filter((candidate) => {
        const text = candidate.text;
        return (
          text.length > 120 &&
          /Market News|Strategic Analysis|Short-Term|Short-term|Trend/i.test(text) &&
          !/Place Order|Available|Order Price/i.test(text.slice(0, 300))
        );
      })
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

    return candidates[0]?.text || document.body.innerText || "";
  });

  const researchText = trimNonResearchText(rawText);

  if (!researchText || researchText.length < 80) {
    throw new Error("AI Research text was not found or was too short");
  }

  return researchText;
}

async function scrapeAiResearch(symbol, options = {}) {
  const timeoutMs = options.timeoutMs || config.coinex.scrapeTimeoutMs;
  const headless = options.headless ?? config.runtime.headless;
  const url = `${config.coinex.baseUrl}/${symbol}`;
  let browser;

  try {
    logger.info("Launching Chromium", { symbol });
    browser = await chromium.launch({ headless });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
    });

    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    logger.info(`Opening ${url}`, { symbol });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});

    logger.info("Opening AI Research tab", { symbol });
    await clickAiResearchTab(page, timeoutMs);
    await waitForResearchContent(page, timeoutMs);

    const text = await extractResearchText(page);

    return {
      symbol,
      datetime: new Date().toISOString(),
      url,
      text,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  scrapeAiResearch,
};
