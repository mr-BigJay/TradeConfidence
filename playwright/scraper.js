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
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatCoinExFuturesSymbol(symbol) {
  const normalized = String(symbol || "BTCUSDT").trim().toUpperCase();
  if (normalized.includes("-")) {
    return normalized;
  }
  if (normalized.endsWith("USDT")) {
    return `${normalized.slice(0, -4)}-USDT`;
  }
  return normalized;
}

function buildFuturesUrls(symbol) {
  const dashed = formatCoinExFuturesSymbol(symbol);
  const lower = dashed.toLowerCase();
  const base = (config.coinex.baseUrl || "https://www.coinex.com/futures").replace(/\/$/, "");
  // Prefer the public EN futures page the desk uses.
  return [
    `https://www.coinex.com/en/futures/${lower}`,
    `https://www.coinex.com/en/futures/${dashed}`,
    `${base}/${dashed}`,
    `${base}/${lower}`,
  ];
}

function trimNonResearchText(text) {
  let cleaned = normalizeText(text);

  const startMarkers = [
    /AI Research/i,
    /Strategic Analysis/i,
    /Market News/i,
    /[A-Z]{2,}.*?(Short|Long|Term|Recovery|Market|Trend|AI)/i,
    /Trend/i,
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

  const endIndexes = EXCLUDE_AFTER_MARKERS.map((marker) => cleaned.indexOf(marker)).filter(
    (index) => index > 80,
  );

  if (endIndexes.length) {
    cleaned = cleaned.slice(0, Math.min(...endIndexes)).trim();
  }

  return normalizeText(cleaned);
}

function textFromResearchPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  const data = payload.data ?? payload;
  const chunks = [];

  const push = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      const cleaned = normalizeText(value);
      if (cleaned.length > 20) chunks.push(cleaned);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      for (const key of [
        "content",
        "text",
        "summary",
        "analysis",
        "strategic_analysis",
        "market_news",
        "short_term",
        "long_term",
        "title",
        "body",
        "desc",
        "description",
      ]) {
        if (value[key]) push(value[key]);
      }
    }
  };

  push(data);
  return normalizeText(chunks.join("\n\n"));
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
    page.getByRole("button", { name: /allow all/i }),
  ];

  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (!count) continue;
      await candidate.first().click({ timeout: 2000 });
      await page.waitForTimeout(400);
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

async function clickAiResearchTab(page) {
  const tabCandidates = [
    page.getByRole("tab", { name: /AI Research/i }),
    page.getByText("AI Research", { exact: true }),
    page.locator("[role='tab']").filter({ hasText: /AI Research/i }),
    page.locator("button, a, div, span").filter({ hasText: /^AI Research$/i }),
    page.locator("text=/AI\\s*Research/i"),
  ];

  for (const candidate of tabCandidates) {
    try {
      const count = await candidate.count();
      if (!count) continue;
      const tab = candidate.first();
      await tab.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await tab.click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      return true;
    } catch (error) {
      logger.debug("AI Research tab click candidate failed", { error: error.message });
    }
  }
  return false;
}

async function waitForResearchContent(page, timeoutMs) {
  await Promise.any([
    page.waitForSelector("text=Market News", { timeout: timeoutMs }),
    page.waitForSelector("text=Strategic Analysis", { timeout: timeoutMs }),
    page.waitForSelector("text=Short-Term", { timeout: timeoutMs }),
    page.waitForSelector("text=Short-term", { timeout: timeoutMs }),
    page.waitForSelector("text=Long-term", { timeout: timeoutMs }),
  ]).catch(() => {
    throw new Error("Timed out waiting for AI Research content");
  });
}

async function extractResearchText(page) {
  const rawText = await page.evaluate(() => {
    const visibilityCache = new WeakMap();

    function isVisible(element) {
      if (visibilityCache.has(element)) return visibilityCache.get(element);
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
        ["AI Research", 8],
        ["Trend", 8],
        ["Market News", 20],
        ["Strategic Analysis", 20],
        ["Short-term", 10],
        ["Long-term", 10],
        ["sources", 5],
      ];
      for (const [marker, weight] of checks) {
        if (text.toLowerCase().includes(marker.toLowerCase())) score += weight;
      }
      if (text.includes("Order Book")) score -= 15;
      if (text.includes("Trades")) score -= 10;
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
          /Market News|Strategic Analysis|Short-Term|Short-term|Long-term|AI Research|Trend/i.test(
            text,
          ) &&
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

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function launchBrowser(headless) {
  const resolvedHeadless = process.env.DISPLAY ? headless : true;
  process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = "0";

  logger.info("Chromium launch config", {
    requestedHeadless: headless,
    resolvedHeadless,
    hasDisplay: Boolean(process.env.DISPLAY),
  });

  const browser = await chromium.launch({
    headless: resolvedHeadless,
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
      "--js-flags=--max-old-space-size=384",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--mute-audio",
      "--no-first-run",
    ],
  });

  logger.info("Chromium launched successfully");
  return browser;
}

async function scrapeOnce(symbol, options = {}) {
  const timeoutMs = options.timeoutMs || config.coinex.scrapeTimeoutMs || 45000;
  const headless = options.headless ?? config.runtime.headless;
  const urls = buildFuturesUrls(symbol);
  let browser;
  const apiTexts = [];

  try {
    browser = await launchBrowser(headless);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "Europe/Berlin",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await withTimeout(
      context.newPage(),
      30000,
      "Timed out while creating browser page",
    );
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!/coinex\.com\/res\//i.test(url)) return;
        if (!/ai|research|analysis|insight|strateg|news|report|information/i.test(url)) return;
        const contentType = response.headers()["content-type"] || "";
        if (!/json/i.test(contentType)) return;
        const payload = await response.json().catch(() => null);
        const text = textFromResearchPayload(payload);
        if (text.length > 80) {
          apiTexts.push({ url, text });
        }
      } catch (error) {
        // ignore response parse errors
      }
    });

    let lastError = null;
    for (const url of urls) {
      try {
        logger.info(`Opening ${url}`, { symbol });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 20000) }).catch(
          () => {},
        );
        await page.waitForTimeout(2500);
        await dismissBlockingModals(page);

        // Futures SPA sometimes redirects away when blocked.
        if (!/\/futures\//i.test(page.url())) {
          throw new Error(`CoinEx redirected away from futures page to ${page.url()}`);
        }

        await assertCoinExPageAvailable(page);

        // Scroll to reveal lower tabs/panels.
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(800);

        logger.info("Opening AI Research tab", { symbol, url: page.url() });
        const clicked = await clickAiResearchTab(page);
        if (!clicked) {
          logger.warn("AI Research tab not clicked; waiting for content anyway", {
            symbol,
            url: page.url(),
          });
        }

        await waitForResearchContent(page, timeoutMs).catch(async (error) => {
          if (apiTexts[0]?.text) return;
          throw error;
        });

        let text = "";
        try {
          text = await extractResearchText(page);
        } catch (error) {
          if (apiTexts[0]?.text) {
            text = apiTexts[0].text;
            logger.info("Using CoinEx research payload from network capture", {
              symbol,
              url: apiTexts[0].url,
              length: text.length,
            });
          } else {
            throw error;
          }
        }

        return {
          symbol,
          datetime: new Date().toISOString(),
          url: page.url(),
          text,
        };
      } catch (error) {
        lastError = error;
        logger.warn("CoinEx URL attempt failed", { symbol, url, error: error.message });
      }
    }

    throw lastError || new Error("CoinEx AI Research scrape failed");
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function scrapeAiResearch(symbol, options = {}) {
  const attempts = Math.max(1, Number(options.retries || 2));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      logger.info("Scraping CoinEx AI Research", { symbol, attempt, attempts });
      const result = await scrapeOnce(symbol, options);
      logger.info("CoinEx AI Research scraped", {
        symbol,
        length: result.text?.length || 0,
        url: result.url,
      });
      return result;
    } catch (error) {
      lastError = error;
      logger.warn("CoinEx AI Research scrape attempt failed", {
        symbol,
        attempt,
        error: error.message,
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  throw lastError || new Error("CoinEx AI Research scrape failed");
}

module.exports = {
  scrapeAiResearch,
  buildFuturesUrls,
  formatCoinExFuturesSymbol,
  trimNonResearchText,
};
