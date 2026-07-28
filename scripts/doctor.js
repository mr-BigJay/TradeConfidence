#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const config = require("../config/config");
const { closeDb, getDb, getLatestAnalysis, getLatestContent } = require("../database/db");

function mask(value) {
  const text = String(value || "");
  if (!text) return "(missing)";
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function main() {
  const dbPath = path.resolve(config.runtime.databasePath);
  console.log("=== CoinEx AI Bot Doctor ===");
  console.log(`cwd: ${process.cwd()}`);
  console.log(`db: ${dbPath} (${fs.existsSync(dbPath) ? "exists" : "missing"})`);
  console.log(`symbols: ${config.coinex.symbols.join(", ")}`);
  console.log(`dailyCron: ${config.scheduler.dailyCron} (${config.scheduler.timezone})`);
  console.log(`scenarioCheck: ${config.scheduler.scenarioCheckEnabled ? config.scheduler.scenarioCheckCron : "disabled"}`);
  console.log(`intradayEnabled: ${config.scheduler.intradayEnabled}`);
  console.log(`intervalMinutes: ${config.scheduler.intervalMinutes}`);
  console.log(`cardMode: ${config.runtime.cardMode}`);
  console.log(`openai.baseURL: ${config.openai.baseURL || "(default)"}`);
  console.log(`openai.model: ${config.openai.model}`);
  console.log(`openai.key: ${mask(config.openai.apiKey)}`);
  console.log(`telegram.token: ${mask(config.telegram.botToken)}`);
  console.log(`telegram.chatId: ${config.telegram.chatId ? "set" : "(missing)"}`);

  const database = await getDb();
  const symbol = config.coinex.symbols[0] || "BTCUSDT";
  const latestContent = await getLatestContent(symbol);
  const latestAnalysis = await getLatestAnalysis(symbol);
  const events = await database.all(
    "SELECT created_at, event, message FROM event_logs WHERE symbol = ? OR symbol IS NULL ORDER BY id DESC LIMIT 20",
    symbol,
  );

  console.log("\n--- Latest content ---");
  if (!latestContent) {
    console.log("none");
  } else {
    console.log(`scraped_at: ${latestContent.scraped_at}`);
    console.log(`source_updated_at: ${latestContent.source_updated_at || "(none)"}`);
    console.log(`text_hash: ${String(latestContent.text_hash).slice(0, 16)}...`);
    console.log(`raw_text_length: ${String(latestContent.raw_text || "").length}`);
  }

  console.log("\n--- Latest analysis ---");
  if (!latestAnalysis) {
    console.log("none");
  } else {
    console.log(`created_at: ${latestAnalysis.created_at}`);
    console.log(`bias: ${latestAnalysis.analysis?.bias || "-"}`);
    console.log(`confidence: ${latestAnalysis.analysis?.confidence || "-"}`);
  }

  console.log("\n--- Recent events ---");
  if (!events.length) {
    console.log("none");
  } else {
    for (const event of events) {
      const msg = String(event.message || "").replace(/\s+/g, " ").slice(0, 160);
      console.log(`${event.created_at} | ${event.event} | ${msg}`);
    }
  }

  const lastError = events.find((item) => /error|fail/i.test(item.event));
  const lastSkip = events.find((item) => item.event === "no_change");
  const lastTelegram = events.find((item) => item.event === "telegram_success");

  console.log("\n--- Hint ---");
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.log("Telegram config missing. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
  } else if (lastError && (!lastTelegram || lastError.created_at > lastTelegram.created_at)) {
    console.log(`Last failure looks newer than last send: ${lastError.event} -> ${lastError.message}`);
    console.log("Try: npm run run:force");
  } else if (lastSkip && (!lastTelegram || lastSkip.created_at > lastTelegram.created_at)) {
    console.log("Bot is alive but AI Research is unchanged, so Telegram is skipped by design.");
    console.log("To force a send now: npm run run:force");
  } else if (lastTelegram) {
    console.log(`Last successful Telegram: ${lastTelegram.created_at}`);
  } else {
    console.log("No telegram_success yet. Run: npm run run:force");
  }
}

main()
  .catch((error) => {
    console.error("Doctor failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
