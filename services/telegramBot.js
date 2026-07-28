/**
 * Interactive Telegram menu (Backtest + home).
 * Long-polling runs alongside cron jobs.
 */

const config = require("../config/config");
const logger = require("../logger");
const {
  buildBacktestPage,
  backtestKeyboard,
  mainMenuKeyboard,
  formatMainMenu,
  PAGE_SIZE,
} = require("./backtestReport");
const {
  sendTelegramMessageWithMarkup,
  editTelegramMessage,
  answerCallbackQuery,
  setTelegramCommands,
  getTelegramUpdates,
} = require("./telegram");

let polling = false;
let offset = 0;

function allowedChat(chatId) {
  const configured = String(config.telegram.chatId || "");
  if (!configured) return false;
  return String(chatId) === configured;
}

async function sendHomeMenu(chatId) {
  return sendTelegramMessageWithMarkup(formatMainMenu(), mainMenuKeyboard(), chatId);
}

async function sendBacktestPage(chatId, page = 0, { editMessageId = null } = {}) {
  const symbol = config.coinex.symbols[0] || "BTCUSDT";
  const report = await buildBacktestPage(symbol, page, PAGE_SIZE);
  const markup = backtestKeyboard(report.page, report.totalPages);

  // Telegram message limit — trim if somehow huge.
  const text = report.text.slice(0, 4000);

  if (editMessageId) {
    try {
      return await editTelegramMessage(chatId, editMessageId, text, markup);
    } catch (error) {
      // Fall back to new message if edit fails (e.g. identical content).
      logger.warn("editMessageText failed; sending new backtest page", {
        error: error.message,
      });
    }
  }
  return sendTelegramMessageWithMarkup(text, markup, chatId);
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  if (!allowedChat(chatId)) {
    logger.warn("Ignoring telegram message from unexpected chat", { chatId });
    return;
  }

  const text = String(message.text || "").trim();
  if (!text) return;

  if (
    text === "/start" ||
    text === "/menu" ||
    text === "🏠 منو" ||
    text === "منو"
  ) {
    await sendHomeMenu(chatId);
    return;
  }

  if (text === "/help" || text === "ℹ️ راهنما" || text === "راهنما") {
    await sendTelegramMessageWithMarkup(
      [
        "راهنما",
        "",
        "📊 بک تست: لیست ۲۰تایی آخرین پیش‌بینی‌های کندل روز و نتیجه واقعی",
        "/backtest یا دکمه بک تست",
        "/menu منوی اصلی",
      ].join("\n"),
      mainMenuKeyboard(),
      chatId,
    );
    return;
  }

  if (
    text === "/backtest" ||
    text === "📊 بک تست" ||
    text === "بک تست" ||
    text === "بک‌تست"
  ) {
    await sendBacktestPage(chatId, 0);
    return;
  }
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data = String(query.data || "");

  if (!allowedChat(chatId)) {
    await answerCallbackQuery(query.id, "دسترسی ندارید");
    return;
  }

  if (data === "menu:home") {
    await answerCallbackQuery(query.id);
    await sendHomeMenu(chatId);
    return;
  }

  if (data.startsWith("bt:noop:")) {
    await answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("bt:")) {
    const page = Number(data.split(":")[1]);
    if (!Number.isFinite(page) || page < 0) {
      await answerCallbackQuery(query.id, "صفحه نامعتبر");
      return;
    }
    await answerCallbackQuery(query.id, `صفحه ${page + 1}`);
    await sendBacktestPage(chatId, page, { editMessageId: messageId });
    return;
  }

  await answerCallbackQuery(query.id);
}

async function processUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
  }
}

async function pollOnce() {
  const updates = await getTelegramUpdates(offset, 25);
  for (const update of updates) {
    offset = update.update_id + 1;
    try {
      await processUpdate(update);
    } catch (error) {
      logger.error("Telegram update handler failed", {
        updateId: update.update_id,
        error: error.message,
      });
    }
  }
}

async function startTelegramBotMenu() {
  if (polling) return;
  if (!config.telegram.botToken || !config.telegram.chatId) {
    logger.warn("Telegram bot menu not started: missing token/chatId");
    return;
  }

  polling = true;
  try {
    await setTelegramCommands([
      { command: "menu", description: "منوی اصلی" },
      { command: "backtest", description: "بک تست پیش‌بینی روزانه" },
      { command: "help", description: "راهنما" },
    ]);
  } catch (error) {
    logger.warn("setMyCommands failed", { error: error.message });
  }

  logger.info("Telegram bot menu polling started", {
    chatId: config.telegram.chatId,
  });

  // Fire-and-forget loop
  (async () => {
    while (polling) {
      try {
        await pollOnce();
      } catch (error) {
        logger.error("Telegram polling error", { error: error.message });
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
}

function stopTelegramBotMenu() {
  polling = false;
}

module.exports = {
  startTelegramBotMenu,
  stopTelegramBotMenu,
  sendHomeMenu,
  sendBacktestPage,
  handleMessage,
  handleCallback,
  PAGE_SIZE,
};
