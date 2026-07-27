const fs = require("node:fs/promises");
const path = require("node:path");
const OpenAI = require("openai");
const config = require("../config/config");
const { normalizeTradingPlan, normalizePlanEvaluation } = require("./tradingPlanNormalizer");

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
  if (config.openai.jsonMode) request.response_format = { type: "json_object" };
  const response = await openai.chat.completions.create(request);
  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response");
  return parseJsonContent(content);
}

async function createDailyTradingPlan({ symbol, marketBundle, engineScore, validation }) {
  const template = await getPrompt("daily-trading-plan.txt");
  const prompt = template
    .replace("{{ENGINE_SCORE}}", JSON.stringify(engineScore, null, 2))
    .replace("{{VALIDATION}}", JSON.stringify(validation, null, 2))
    .replace("{{MARKET_BUNDLE}}", marketBundle.promptText || JSON.stringify(marketBundle, null, 2));

  const raw = await chatJson(
    "Create one executable BTC daily trading plan as strict JSON. No exchange brand names.",
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
    "Evaluate an existing daily trading plan only. Never invent new Entry/SL/TP. Strict JSON. No brand names.",
    prompt,
  );
  return normalizePlanEvaluation(locked, raw);
}

module.exports = {
  createDailyTradingPlan,
  evaluateDailyTradingPlan,
};
