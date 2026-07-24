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

function formatCoinExFuturesSymbol(symbol) {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes("-")) {
    return normalized;
  }

  if (normalized.endsWith("USDT")) {
    return `${normalized.slice(0, -4)}-USDT`;
  }

  return normalized;
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

  await assertCoinExPageAvailable(page);
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  throw new Error(
    `AI Research tab not found. Final URL: ${page.url()}. Page text: ${normalizeText(bodyText).slice(0, 300)}`,
  );
}

async function waitForResearchContent(page, timeoutMs) {
  await Promise.any([
    page.waitForSelector("text=Market News", { timeout: timeoutMs }),
    page.waitForSelector("text=Strategic Analysis", { timeout: timeoutMs }),
    page.waitForSelector("text=Short-Term", { timeout: timeoutMs }),
  ]).catch(() => {
    throw new Error("Timed out waiting for AI Research content");
  });
}

function isGeoBlockedText(bodyText) {
  return (
    /unable to provide services to users in your location/i.test(bodyText) ||
    /service is no longer available for users in the region of your IP address/i.test(bodyText) ||
    /our service is no longer available for users in the region/i.test(bodyText)
  );
}

async function dismissBlockingModals(page) {
  const candidates = [
    page.getByRole("button", { name: /got it/i }),
    page.getByText("Got It", { exact: true }),
    page.getByRole("button", { name: /accept/i }),
    page.getByRole("button", { name: /agree/i }),
  ];

  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (!count) {
        continue;
      }

      await candidate.first().click({ timeout: 2000 });
      await page.waitForTimeout(500);
    } catch (error) {
      logger.debug("Modal dismiss candidate failed", { error: error.message });
    }
  }
}

async function assertCoinExPageAvailable(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");

  if (isGeoBlockedText(bodyText)) {
    const locationMatch = bodyText.match(/Your IP Location:\s*([^\n]+)/i);
    const location = locationMatch ? locationMatch[1].trim() : "unknown";
    throw new Error(
      `CoinEx unavailable for current location or IP address (detected: ${location}). Choose a VPS region where CoinEx Futures fully loads.`,
    );
  }

  if (/captcha|verify you are human/i.test(bodyText)) {
    throw new Error("CoinEx verification challenge detected");
  }
}

async function waitForInitialRender(page) {
  await page
    .waitForFunction(() => (document.body?.innerText || "").trim().length > 20, null, {
      timeout: 10000,
    })
    .catch(() => {});
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
  const coinexSymbol = formatCoinExFuturesSymbol(symbol);
  const url = `${config.coinex.baseUrl}/${coinexSymbol}`;
  let browser;

  try {
    logger.info("Launching Chromium", { symbol });
    browser = await chromium.launch({
      headless,
      timeout: 60000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    logger.info(`Opening ${url}`, { symbol });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
    await waitForInitialRender(page);
    await dismissBlockingModals(page);
    await assertCoinExPageAvailable(page);

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
