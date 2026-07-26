const fs = require("node:fs/promises");
const path = require("node:path");
const OpenAI = require("openai");
const config = require("../config/config");
const { normalizeDailySetup, normalizeSetupEvaluation } = require("./setupNormalizer");

let client;
const promptCache = new Map();

function normalizeApiKey(apiKey) {
  return String(apiKey || "")
    .trim()
    .replace(/^apikey\s+/i, "");
}

function getClient() {
  const apiKey = normalizeApiKey(config.openai.apiKey);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  if (!client) {
    const options = { apiKey };
    if (config.openai.baseURL) {
      options.baseURL = config.openai.baseURL;
    }
    if (config.openai.authScheme === "apikey") {
      options.defaultHeaders = {
        Authorization: `apikey ${apiKey}`,
      };
    }
    client = new OpenAI(options);
  }

  return client;
}

async function getPrompt(fileName) {
  if (!promptCache.has(fileName)) {
    const text = await fs.readFile(path.join("prompts", fileName), "utf8");
    promptCache.set(fileName, text);
  }
  return promptCache.get(fileName);
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function chatJson(system, user) {
  const openai = getClient();
  const request = {
    model: config.openai.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (config.openai.jsonMode) {
    request.response_format = { type: "json_object" };
  }
  const response = await openai.chat.completions.create(request);
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  return parseJsonContent(content);
}

async function createDailySetup({ symbol, bitunixDaily }) {
  const template = await getPrompt("daily-setup.txt");
  const prompt = template.replace(
    "{{BITUNIX_DAILY_DATA}}",
    bitunixDaily?.checklistText || JSON.stringify(bitunixDaily, null, 2),
  );

  const raw = await chatJson(
    "You create one BTC daily futures setup as strict JSON. No brand names. One setup only.",
    prompt,
  );
  return normalizeDailySetup(symbol, raw);
}

async function evaluateDailySetup({
  symbol,
  dailySetup,
  bitunix1h,
  researchText = "",
  previousEvaluation = null,
}) {
  const template = await getPrompt("setup-eval.txt");
  const locked = {
    bias: dailySetup.bias,
    direction: dailySetup.direction,
    confidence: dailySetup.confidence,
    market_score: dailySetup.market_score,
    entry: dailySetup.entry,
    stop_loss: dailySetup.stop_loss,
    tp1: dailySetup.tp1,
    tp2: dailySetup.tp2,
    tp3: dailySetup.tp3,
    supports: dailySetup.supports,
    resistances: dailySetup.resistances,
    invalidation: dailySetup.setup?.invalidation || dailySetup.invalidation || "",
    status: dailySetup.status,
  };

  const prompt = template
    .replace("{{DAILY_SETUP}}", JSON.stringify(locked, null, 2))
    .replace(
      "{{PREVIOUS_EVALUATION}}",
      previousEvaluation ? JSON.stringify(previousEvaluation, null, 2) : "None",
    )
    .replace(
      "{{BITUNIX_1H_DATA}}",
      bitunix1h?.checklistText || JSON.stringify(bitunix1h, null, 2),
    )
    .replace("{{AI_RESEARCH_TEXT}}", researchText || "");

  const raw = await chatJson(
    "You only evaluate an existing daily setup. Never create new Entry/SL/TP. Strict JSON only. No brand names.",
    prompt,
  );

  return normalizeSetupEvaluation(
    {
      ...locked,
      supports: dailySetup.supports || [],
      resistances: dailySetup.resistances || [],
    },
    raw,
  );
}

module.exports = {
  createDailySetup,
  evaluateDailySetup,
};
