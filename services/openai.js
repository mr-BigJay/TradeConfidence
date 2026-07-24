const fs = require("node:fs/promises");
const path = require("node:path");
const OpenAI = require("openai");
const config = require("../config/config");

let client;
let promptTemplate;

function getClient() {
  if (!config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  if (!client) {
    client = new OpenAI({ apiKey: config.openai.apiKey });
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

function normalizeAnalysis(symbol, analysis) {
  return {
    title: analysis.title || `${symbol} وضعیت بازار`,
    symbol,
    trend: analysis.trend || "Neutral",
    bias: analysis.bias || "نامشخص",
    confidence: Number.parseInt(analysis.confidence, 10) || 0,
    bullish_probability: Number.parseInt(analysis.bullish_probability, 10) || 50,
    bearish_probability: Number.parseInt(analysis.bearish_probability, 10) || 50,
    key_resistance: Array.isArray(analysis.key_resistance) ? analysis.key_resistance : [],
    key_support: Array.isArray(analysis.key_support) ? analysis.key_support : [],
    current_range: analysis.current_range || "نامشخص",
    bullish_scenario: analysis.bullish_scenario || "",
    neutral_scenario: analysis.neutral_scenario || "",
    bearish_scenario: analysis.bearish_scenario || "",
    short_term_strategy: analysis.short_term_strategy || "",
    long_term_strategy: analysis.long_term_strategy || "",
    risk_level: analysis.risk_level || "Medium",
    risk_notes: analysis.risk_notes || "",
    trading_action: "NO_SIGNAL",
    summary: analysis.summary || "",
  };
}

async function analyzeAiResearch({ symbol, text }) {
  const template = await getPromptTemplate();
  const prompt = template.replace("{{AI_RESEARCH_TEXT}}", text);
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You produce strict JSON for Persian crypto market status reports. You never provide financial advice or direct buy/sell signals.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  return normalizeAnalysis(symbol, parseJsonContent(content));
}

module.exports = {
  analyzeAiResearch,
};
