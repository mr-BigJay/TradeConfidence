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

async function analyzeAiResearch({ symbol, text, bitunixData = null }) {
  const template = await getPromptTemplate();
  const bitunixBlock =
    bitunixData?.checklistText ||
    (bitunixData ? JSON.stringify(bitunixData, null, 2) : "Bitunix data unavailable");

  // CoinEx roadmap first in the user payload ordering of sections in the prompt file.
  const prompt = template
    .replace("{{BITUNIX_DATA}}", bitunixBlock)
    .replace("{{AI_RESEARCH_TEXT}}", text || "");

  const openai = getClient();

  const request = {
    model: config.openai.model,
    messages: [
      {
        role: "system",
        content:
          "You produce strict JSON for Persian crypto market status. CoinEx AI Research is the main roadmap; Bitunix 1h data only confirms or challenges it. Write clean formal Persian with no typos. Keep text compact for one Telegram message. Never give direct buy/sell orders. Always include long_confirm and short_confirm.",
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
