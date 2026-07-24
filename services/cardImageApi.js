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

function isGeminiImageModel(modelName = "") {
  return /gemini/i.test(modelName) && /image/i.test(modelName);
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

function extractImagePayload(payload) {
  const direct = payload?.data?.[0];
  if (direct?.b64_json || direct?.url) {
    return direct;
  }

  const message = payload?.choices?.[0]?.message;
  if (message?.images?.[0]) {
    const image = message.images[0];
    return {
      b64_json: image.b64_json || image.data || null,
      url: image.url || null,
    };
  }

  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part?.type === "image_url" && part?.image_url?.url) {
        const url = part.image_url.url;
        if (url.startsWith("data:image")) {
          return { b64_json: url.split(",")[1], url: null };
        }
        return { b64_json: null, url };
      }
      if (part?.inline_data?.data || part?.inlineData?.data) {
        return {
          b64_json: part.inline_data?.data || part.inlineData?.data,
          url: null,
        };
      }
    }
  }

  const parts =
    payload?.candidates?.[0]?.content?.parts ||
    payload?.candidates?.[0]?.content?.[0]?.parts ||
    [];

  for (const part of parts) {
    if (part?.inlineData?.data || part?.inline_data?.data) {
      return {
        b64_json: part.inlineData?.data || part.inline_data?.data,
        url: null,
      };
    }
    if (part?.fileData?.fileUri || part?.file_data?.file_uri) {
      return {
        b64_json: null,
        url: part.fileData?.fileUri || part.file_data?.file_uri,
      };
    }
  }

  return null;
}

async function postJson(endpoint, apiKey, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authHeader(apiKey, config.image.authScheme),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function tryOpenAiImages({ baseURL, apiKey, model, prompt }) {
  const endpoint = `${baseURL}/images/generations`;
  logger.info("Trying OpenAI-style image generations", { endpoint, model });

  const { response, payload } = await postJson(endpoint, apiKey, {
    model,
    prompt,
    n: 1,
    size: config.image.size,
    response_format: "b64_json",
    quality: config.image.quality,
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI images error: ${payload.error?.message || payload.message || response.statusText}`,
    );
  }

  const image = extractImagePayload(payload);
  if (!image) {
    throw new Error("OpenAI images response had no image data");
  }

  return image;
}

async function tryGeminiChatCompletions({ baseURL, apiKey, model, prompt }) {
  const endpoint = `${baseURL}/chat/completions`;
  logger.info("Trying Gemini image via chat.completions", { endpoint, model });

  const bodies = [
    {
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["text", "image"],
    },
    {
      model,
      messages: [{ role: "user", content: prompt }],
      response_modalities: ["TEXT", "IMAGE"],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "2K",
        },
      },
    },
  ];

  let lastError = null;

  for (const body of bodies) {
    const { response, payload } = await postJson(endpoint, apiKey, body);
    if (!response.ok) {
      lastError = new Error(
        `Gemini chat image error: ${payload.error?.message || payload.message || response.statusText}`,
      );
      continue;
    }

    const image = extractImagePayload(payload);
    if (image) {
      return image;
    }

    lastError = new Error("Gemini chat response had no image data");
  }

  throw lastError || new Error("Gemini chat image generation failed");
}

async function tryGeminiGenerateContent({ baseURL, apiKey, model, prompt }) {
  const endpoint = `${baseURL}/models/${encodeURIComponent(model)}:generateContent`;
  logger.info("Trying Gemini generateContent", { endpoint, model });

  const { response, payload } = await postJson(endpoint, apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "2K",
      },
    },
  });

  if (!response.ok) {
    throw new Error(
      `Gemini generateContent error: ${payload.error?.message || payload.message || response.statusText}`,
    );
  }

  const image = extractImagePayload(payload);
  if (!image) {
    throw new Error("Gemini generateContent response had no image data");
  }

  return image;
}

async function generateAnalysisCardWithApi(analysis) {
  const apiKey = normalizeApiKey(config.image.apiKey);
  if (!apiKey) {
    throw new Error("IMAGE_API_KEY (or OPENAI_API_KEY) is missing");
  }

  if (!config.image.baseURL) {
    throw new Error(
      "IMAGE_BASE_URL is missing. Use IMAGE_BASE_URL (not OPENAI_BASE_URL) for the image model gateway.",
    );
  }

  if (!config.image.model) {
    throw new Error("IMAGE_MODEL is missing");
  }

  const prompt = await buildImagePrompt(analysis);
  const baseURL = config.image.baseURL.replace(/\/$/, "");
  const model = config.image.model;

  const attempts = isGeminiImageModel(model)
    ? [
        () => tryGeminiChatCompletions({ baseURL, apiKey, model, prompt }),
        () => tryGeminiGenerateContent({ baseURL, apiKey, model, prompt }),
        () => tryOpenAiImages({ baseURL, apiKey, model, prompt }),
      ]
    : [
        () => tryOpenAiImages({ baseURL, apiKey, model, prompt }),
        () => tryGeminiChatCompletions({ baseURL, apiKey, model, prompt }),
      ];

  let image = null;
  const errors = [];

  for (const attempt of attempts) {
    try {
      image = await attempt();
      break;
    } catch (error) {
      errors.push(error.message);
      logger.warn("Image API attempt failed", { error: error.message });
    }
  }

  if (!image) {
    throw new Error(`All image API attempts failed: ${errors.join(" | ")}`);
  }

  await fs.mkdir("output", { recursive: true });
  const filePath = path.join(
    "output",
    `${analysis.symbol}-api-card-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );

  if (image.b64_json) {
    await fs.writeFile(filePath, Buffer.from(image.b64_json, "base64"));
  } else if (image.url) {
    await downloadToFile(image.url, filePath);
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
