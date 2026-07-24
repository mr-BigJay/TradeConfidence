const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config/config");
const logger = require("../logger");

function normalizeApiKey(apiKey) {
  return String(apiKey || "")
    .trim()
    .replace(/^apikey\s+/i, "");
}

function authHeader(apiKey, authScheme) {
  if (authScheme === "apikey") {
    return `apikey ${apiKey}`;
  }

  return `Bearer ${apiKey}`;
}

function fillTemplate(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{{${key}}}`, value);
  }, template);
}

function listOrDash(items, mapper = (item) => item) {
  if (!items?.length) {
    return "نامشخص";
  }

  return items.map(mapper).join(" | ");
}

async function buildImagePrompt(analysis) {
  const template = await fs.readFile(path.join("prompts", "card-image.txt"), "utf8");

  return fillTemplate(template, {
    BIAS: analysis.bias || "خنثی",
    CONFIDENCE: String(analysis.confidence || 0),
    INSIGHTS: listOrDash(
      (analysis.insights || []).slice(0, 4),
      (item, index) => `${index + 1}) ${item.title}: ${item.text}`,
    ),
    RESISTANCES: listOrDash(analysis.key_resistance),
    SUPPORTS: listOrDash(analysis.key_support),
    RANGE: analysis.current_range || "نامشخص",
    PRICE: analysis.current_price || "-",
    STRUCTURE: analysis.structure || "نامشخص",
    VOLUME: analysis.volume_status || "نامشخص",
    MOMENTUM: analysis.momentum_status || "نامشخص",
    BULL_PCT: String(analysis.bullish_scenario_probability || 0),
    BULL_TEXT: analysis.bullish_scenario || "نامشخص",
    BULL_TARGETS: listOrDash(analysis.bullish_targets),
    NEUTRAL_PCT: String(analysis.neutral_scenario_probability || 0),
    NEUTRAL_TEXT: analysis.neutral_scenario || "نامشخص",
    BEAR_PCT: String(analysis.bearish_scenario_probability || 0),
    BEAR_TEXT: analysis.bearish_scenario || "نامشخص",
    BEAR_TARGETS: listOrDash(analysis.bearish_targets),
    INDICATORS: listOrDash(
      (analysis.indicators || []).slice(0, 7),
      (item) => `${item.name}: ${item.status}`,
    ),
    LONG_STRATEGY: analysis.long_term_strategy || "نامشخص",
    SHORT_STRATEGY: analysis.short_term_strategy || "نامشخص",
    LONG_TREND: analysis.long_term_trend || "نامشخص",
    SHORT_TREND: analysis.short_term_trend || "نامشخص",
    BULLISH_PROB: String(analysis.bullish_probability || 0),
    CORRECTION_PROB: String(analysis.correction_probability || analysis.bearish_probability || 0),
  });
}

async function downloadToFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

async function generateAnalysisCardWithApi(analysis) {
  const apiKey = normalizeApiKey(config.image.apiKey);
  if (!apiKey) {
    throw new Error("IMAGE_API_KEY (or OPENAI_API_KEY) is missing");
  }

  if (!config.image.baseURL) {
    throw new Error(
      "IMAGE_BASE_URL is missing. Create an Arvan image-model endpoint and put its /v1 gateway URL here.",
    );
  }

  if (!config.image.model) {
    throw new Error("IMAGE_MODEL is missing");
  }

  const prompt = await buildImagePrompt(analysis);
  const endpoint = `${config.image.baseURL.replace(/\/$/, "")}/images/generations`;

  logger.info("Generating analysis card via image API", {
    endpoint,
    model: config.image.model,
    size: config.image.size,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader(apiKey, config.image.authScheme),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.image.model,
      prompt,
      n: 1,
      size: config.image.size,
      response_format: "b64_json",
      quality: config.image.quality,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Image API error: ${payload.error?.message || payload.message || response.statusText}`,
    );
  }

  const item = payload.data?.[0];
  if (!item) {
    throw new Error("Image API returned no image data");
  }

  await fs.mkdir("output", { recursive: true });
  const filePath = path.join(
    "output",
    `${analysis.symbol}-api-card-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );

  if (item.b64_json) {
    await fs.writeFile(filePath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    await downloadToFile(item.url, filePath);
  } else {
    throw new Error("Image API response missing b64_json/url");
  }

  logger.info("API analysis card image created", { filePath });
  return filePath;
}

module.exports = {
  buildImagePrompt,
  generateAnalysisCardWithApi,
};
