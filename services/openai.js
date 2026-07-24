const fs = require("node:fs/promises");
const path = require("node:path");
const OpenAI = require("openai");
const config = require("../config/config");
const { normalizeAnalysis } = require("./analysisNormalizer");

let client;
let promptTemplate;

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
    const options = {
      apiKey,
    };

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

async function getPromptTemplate() {
  if (!promptTemplate) {
    promptTemplate = await fs.readFile(path.join("prompts", "analysis.txt"), "utf8");
  }

  return promptTemplate;
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw error;
    }

    return JSON.parse(match[0]);
  }
}

function buildPreviousSnapshot(previousAnalysis) {
  if (!previousAnalysis || typeof previousAnalysis !== "object") {
    return "No previous report available.";
  }

  const snapshot = {
    bias: previousAnalysis.bias,
    confidence: previousAnalysis.confidence,
    market_summary: previousAnalysis.market_summary || previousAnalysis.summary,
    short_term_trend: previousAnalysis.short_term_trend,
    long_term_trend: previousAnalysis.long_term_trend,
    key_support: previousAnalysis.key_support,
    key_resistance: previousAnalysis.key_resistance,
    bullish_scenario_probability: previousAnalysis.bullish_scenario_probability,
    bearish_scenario_probability: previousAnalysis.bearish_scenario_probability,
    final_verdict: previousAnalysis.final_verdict,
  };

  return JSON.stringify(snapshot, null, 2);
}

async function analyzeAiResearch({ symbol, text, previousAnalysis = null }) {
  const template = await getPromptTemplate();
  const prompt = template
    .replace("{{PREVIOUS_ANALYSIS}}", buildPreviousSnapshot(previousAnalysis))
    .replace("{{AI_RESEARCH_TEXT}}", text || "");

  const openai = getClient();

  const request = {
    model: config.openai.model,
    messages: [
      {
        role: "system",
        content:
          "You produce strict JSON for a short practical Persian market note. Use the AI Research text as factual base, but rewrite simply so a normal user knows what to do next. Do not over-copy the research. Never invent levels absent from it. Never mention CoinEx/Bitunix/Coinglass. Never give direct buy/sell orders. End with simple long_confirm and short_confirm: where, how, invalidation.",
      },
      {
        role: "user",
        content: prompt,
      },
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

  return normalizeAnalysis(symbol, parseJsonContent(content));
}

module.exports = {
  analyzeAiResearch,
};
