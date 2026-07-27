#!/usr/bin/env node
const { sendTelegramTest } = require("../services/telegram");
const config = require("../config/config");
const { closeDb } = require("../database/db");

async function main() {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env");
  }

  console.log(`Sending test message to chat_id=${config.telegram.chatId} ...`);
  const payload = await sendTelegramTest(
    `BTC Analyzer ping ✅\nchat_id=${config.telegram.chatId}\ntime=${new Date().toISOString()}`,
  );
  console.log("Telegram OK");
  console.log(`message_id=${payload.result?.message_id}`);
  console.log(`chat=${payload.result?.chat?.title || payload.result?.chat?.username || payload.result?.chat?.id}`);
}

main()
  .catch((error) => {
    console.error("Telegram test failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => {});
  });
