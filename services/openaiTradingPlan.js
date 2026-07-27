const fs = require("node:fs/promises");
const path = require("node:path");
const OpenAI = require("openai");
const config = require("../config/config");
const { tryParseJson } = require("./jsonRepair");
const { normalizeTradingPlan, normalizePlanEvaluation } = require("./tradingPlanNormalizer");
const logger = require("../logger");

let client;
const promptCache = new Map();

function normalizeApiKey(apiKey) {
  return String(apiKey || "")
    .trim()
    .replace(/^apikey\s+/i, "");
}

function getClient() {
  const apiKey = normalizeApiKey(config.openai.apiKey);
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");
  if (!client) {
    const options = { apiKey };
    if (config.openai.baseURL) options.baseURL = config.openai.baseURL;
    if (config.openai.authScheme === "apikey") {
      options.defaultHeaders = { Authorization: `apikey ${apiKey}` };
    }
    client = new OpenAI(options);
  }
  return client;
}

async function getPrompt(fileName) {
  if (!promptCache.has(fileName)) {
    promptCache.set(fileName, await fs.readFile(path.join("prompts", fileName), "utf8"));
  }
  return promptCache.get(fileName);
}

async function chatJson(system, user, { retries = 2 } = {}) {
  const openai = getClient();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    if (attempt > 0) {
      messages.push({
        role: "user",
        content:
          "Previous response was invalid JSON. Reply again with ONLY a valid minified JSON object. No markdown.",
      });
    }

    const request = {
      model: config.openai.model,
      messages,
    };
    if (config.openai.jsonMode) request.response_format = { type: "json_object" };

    const response = await openai.chat.completions.create(request);
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      lastError = new Error("OpenAI returned an empty response");
      continue;
    }

    try {
      return tryParseJson(content);
    } catch (error) {
      lastError = error;
      logger.warn("Model JSON parse failed; retrying", {
        attempt: attempt + 1,
        error: error.message,
      });
    }
  }

  throw lastError || new Error("Failed to parse model JSON");
}

async function createDailyTradingPlan({ symbol, marketBundle, engineScore, validation }) {
  const template = await getPrompt("daily-trading-plan.txt");
  const prompt = template
    .replace("{{ENGINE_SCORE}}", JSON.stringify(engineScore, null, 2))
    .replace("{{VALIDATION}}", JSON.stringify(validation, null, 2))
    .replace("{{MARKET_BUNDLE}}", marketBundle.promptText || JSON.stringify(marketBundle, null, 2));

  const raw = await chatJson(
    "Create one executable BTC daily trading plan as strict JSON only. No markdown fences. No exchange brand names.",
    prompt,
  );
  return normalizeTradingPlan(symbol, raw, engineScore);
}

async function evaluateDailyTradingPlan({
  symbol,
  dailyPlan,
  marketBundle,
  engineScore,
  validation,
}) {
  const template = await getPrompt("plan-eval.txt");
  const locked = {
    bias: dailyPlan.bias,
    direction: dailyPlan.direction,
    confidence: dailyPlan.confidence,
    market_score: dailyPlan.market_score,
    entry: dailyPlan.entry,
    stop_loss: dailyPlan.stop_loss,
    tp1: dailyPlan.tp1,
    tp2: dailyPlan.tp2,
    tp3: dailyPlan.tp3,
    supports: dailyPlan.supports,
    resistances: dailyPlan.resistances,
    invalidation_level: dailyPlan.invalidation_level,
    status: dailyPlan.status,
  };

  const prompt = template
    .replace("{{DAILY_PLAN}}", JSON.stringify(locked, null, 2))
    .replace("{{ENGINE_SCORE}}", JSON.stringify(engineScore, null, 2))
    .replace("{{VALIDATION}}", JSON.stringify(validation, null, 2))
    .replace("{{MARKET_BUNDLE}}", marketBundle.promptText || JSON.stringify(marketBundle, null, 2));

  const raw = await chatJson(
    "Evaluate an existing daily trading plan only. Never invent new Entry/SL/TP. Reply with strict JSON only. No brand names.",
    prompt,
  );
  return normalizePlanEvaluation(locked, raw);
}

module.exports = {
  createDailyTradingPlan,
  evaluateDailyTradingPlan,
};
