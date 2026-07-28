const cron = require("node-cron");
const config = require("./config/config");
const { closeDb } = require("./database/db");
const logger = require("./logger");
const { runDailySetup } = require("./services/dailySetupPipeline");
const { runIntradayMonitor } = require("./services/intradayPipeline");
const { runScenarioCheck } = require("./services/scenarioCheckPipeline");
const {
  needsMorningBriefCatchUp,
  isMorningDeliveryWatchWindow,
} = require("./services/deliveryGuard");
const { startTelegramBotMenu, stopTelegramBotMenu } = require("./services/telegramBot");
const {
  IRAN_TZ,
  formatIranClock,
  isPastIranDailyBriefTime,
  getIranDateString,
} = require("./services/timeIran");

const args = new Set(process.argv.slice(2));
let isRunning = false;

function buildCronExpression(intervalMinutes) {
  if (intervalMinutes === 60) {
    return "0 * * * *";
  }

  if (intervalMinutes < 1 || intervalMinutes > 59) {
    throw new Error("CHECK_INTERVAL_MINUTES must be between 1 and 60");
  }

  return `*/${intervalMinutes} * * * *`;
}

async function runSafely(label, fn, options = {}) {
  if (isRunning) {
    // Critical morning / scenario ticks must not be silently dropped.
    if (options.queueIfBusy) {
      logger.warn("Pipeline busy; retrying critical tick shortly", { label });
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      if (isRunning) {
        logger.error("Critical tick still blocked after wait; forcing skip flag clear risk", {
          label,
        });
        return;
      }
    } else {
      logger.warn("Previous pipeline run is still active, skipping this tick", { label });
      return;
    }
  }

  isRunning = true;
  try {
    return await fn(options);
  } finally {
    isRunning = false;
  }
}

async function ensureMorningBriefDelivered(reason = "catch_up") {
  const symbol = config.coinex.symbols[0] || "BTCUSDT";
  const check = await needsMorningBriefCatchUp(symbol);
  if (!check.needed) {
    logger.info("Morning brief already delivered", {
      reason: check.reason,
      iranDate: check.iranDate,
      via: reason,
    });
    return { skipped: true, reason: check.reason };
  }

  logger.warn("Morning brief missing — forcing Telegram delivery now", {
    reason: check.reason,
    via: reason,
    iranDate: check.iranDate,
    iranNow: `${getIranDateString()} ${formatIranClock()}`,
  });

  return runSafely(`daily-${reason}`, runDailySetup, {
    force: true,
    queueIfBusy: true,
  });
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
  stopTelegramBotMenu();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  const options = {
    force: args.has("--force"),
  };

  if (args.has("--daily")) {
    await runSafely("daily", runDailySetup, options);
    await closeDb();
    return;
  }

  if (args.has("--intraday") || args.has("--once")) {
    await runSafely("intraday", runIntradayMonitor, options);
    await closeDb();
    return;
  }

  if (args.has("--scenario")) {
    await runSafely("scenario", runScenarioCheck, options);
    await closeDb();
    return;
  }

  // Legacy scrape-only kept for diagnostics.
  if (args.has("--scrape-only")) {
    const { runPipeline } = require("./services/pipeline");
    await runSafely("scrape", runPipeline, { scrapeOnly: true, force: options.force });
    await closeDb();
    return;
  }

  if (!config.telegram.botToken || !config.telegram.chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for scheduled reports");
  }

  const dailyExpression = config.scheduler.dailyCron;
  const intradayEnabled = Boolean(config.scheduler.intradayEnabled);
  const scenarioCheckEnabled = Boolean(config.scheduler.scenarioCheckEnabled);
  const scenarioCheckCron = config.scheduler.scenarioCheckCron;

  logger.info("Starting BTC Advanced Market Intelligence Engine", {
    dailyCron: dailyExpression,
    timezone: IRAN_TZ,
    iranNow: `${getIranDateString()} ${formatIranClock()}`,
    pastBriefTime: isPastIranDailyBriefTime(),
    scenarioCheckEnabled,
    scenarioCheckCron: scenarioCheckEnabled ? scenarioCheckCron : "disabled",
    deliveryWatchdog: "*/5 3-4 * * *",
    intradayEnabled,
    intradayCron: intradayEnabled
      ? buildCronExpression(config.scheduler.intervalMinutes)
      : "disabled",
    symbols: config.coinex.symbols,
    telegramChatConfigured: Boolean(config.telegram.chatId),
    architecture:
      "03:30 brief + 11:30/19:30 scenario checks → Telegram (with delivery watchdog)",
  });

  try {
    const { startBinanceWsCollector } = require("./services/providers/binanceWsCollector");
    await startBinanceWsCollector(config.coinex.symbols[0] || "BTCUSDT");
  } catch (error) {
    logger.warn("Binance WS bootstrap skipped", { error: error.message });
  }

  // Boot: after 03:30, guarantee today's brief was delivered (force if missing/telegram failed).
  if (isPastIranDailyBriefTime()) {
    await ensureMorningBriefDelivered("boot");
  } else {
    logger.info("Boot catch-up skipped until 03:30 Iran daily brief", {
      iranNow: `${getIranDateString()} ${formatIranClock()}`,
      dailyCron: dailyExpression,
    });
  }

  // 03:30 Iran: always regenerate + send.
  cron.schedule(
    dailyExpression,
    () => {
      logger.info("Daily brief cron fired", {
        iranNow: `${getIranDateString()} ${formatIranClock()}`,
        force: true,
      });
      runSafely("daily-cron", runDailySetup, { force: true, queueIfBusy: true }).catch(
        async (error) => {
          logger.error("Scheduled daily setup failed; watchdog will retry", {
            error: error.message,
            stack: error.stack,
          });
        },
      );
    },
    { timezone: IRAN_TZ },
  );

  logger.info("Daily brief cron armed", {
    expression: dailyExpression,
    timezone: IRAN_TZ,
    forceOnTick: true,
  });

  // Safety net: every 5 minutes during 03:xx–04:xx, resend if Telegram delivery missing.
  cron.schedule(
    "*/5 3-4 * * *",
    () => {
      if (!isMorningDeliveryWatchWindow()) return;
      ensureMorningBriefDelivered("watchdog").catch((error) => {
        logger.error("Morning delivery watchdog failed", {
          error: error.message,
          stack: error.stack,
        });
      });
    },
    { timezone: IRAN_TZ },
  );

  logger.info("Morning delivery watchdog armed", {
    expression: "*/5 3-4 * * *",
    window: "03:35-04:30 Asia/Tehran",
    timezone: IRAN_TZ,
  });

  // 11:30 and 19:30 Iran: scenario progress must always send.
  if (scenarioCheckEnabled) {
    cron.schedule(
      scenarioCheckCron,
      () => {
        logger.info("8h scenario check cron fired", {
          iranNow: `${getIranDateString()} ${formatIranClock()}`,
          force: true,
        });
        runSafely("scenario-cron", runScenarioCheck, { force: true, queueIfBusy: true }).catch(
          (error) => {
            logger.error("Scheduled scenario check failed", {
              error: error.message,
              stack: error.stack,
            });
          },
        );
      },
      { timezone: IRAN_TZ },
    );
    logger.info("8h scenario check cron armed", {
      expression: scenarioCheckCron,
      timezone: IRAN_TZ,
      forceOnTick: true,
    });
  } else {
    logger.info("8h scenario check disabled");
  }

  if (intradayEnabled) {
    const intradayExpression = buildCronExpression(config.scheduler.intervalMinutes);
    cron.schedule(
      intradayExpression,
      () => {
        runSafely("intraday", runIntradayMonitor, { force: false }).catch((error) => {
          logger.error("Scheduled intraday monitor failed", {
            error: error.message,
            stack: error.stack,
          });
        });
      },
      { timezone: IRAN_TZ },
    );
  } else {
    logger.info("Intraday monitoring disabled (daily + 8h scenario checks only)");
  }

  // Interactive Telegram menu (Backtest pagination, etc.)
  await startTelegramBotMenu();
}

main().catch(async (error) => {
  logger.error("Fatal error", { error: error.message, stack: error.stack });
  await closeDb();
  process.exit(1);
});
