const cron = require("node-cron");
const config = require("./config/config");
const { closeDb } = require("./database/db");
const logger = require("./logger");
const { runDailySetup } = require("./services/dailySetupPipeline");
const { runIntradayMonitor } = require("./services/intradayPipeline");
const { runScenarioCheck } = require("./services/scenarioCheckPipeline");
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
    logger.warn("Previous pipeline run is still active, skipping this tick", { label });
    return;
  }

  isRunning = true;
  try {
    return await fn(options);
  } finally {
    isRunning = false;
  }
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
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
    intradayEnabled,
    intradayCron: intradayEnabled
      ? buildCronExpression(config.scheduler.intervalMinutes)
      : "disabled",
    symbols: config.coinex.symbols,
    architecture:
      "CoinEx + Binance + Deribit + Chart Intelligence → Daily setup chart (Entry/TP/SL)",
  });

  try {
    const { startBinanceWsCollector } = require("./services/providers/binanceWsCollector");
    await startBinanceWsCollector(config.coinex.symbols[0] || "BTCUSDT");
  } catch (error) {
    logger.warn("Binance WS bootstrap skipped", { error: error.message });
  }

  // Boot catch-up ONLY after 03:30 Iran, and only if today's plan is missing.
  // Never create the morning brief early — that used to make 03:30 cron skip with already_exists.
  if (isPastIranDailyBriefTime()) {
    logger.info("Boot catch-up: past 03:30 Iran; ensuring today's plan exists", {
      iranNow: `${getIranDateString()} ${formatIranClock()}`,
    });
    await runSafely("daily-boot", runDailySetup, { force: false });
  } else {
    logger.info("Boot catch-up skipped until 03:30 Iran daily brief", {
      iranNow: `${getIranDateString()} ${formatIranClock()}`,
      dailyCron: dailyExpression,
    });
  }

  // Scheduled morning brief always regenerates + sends (force), so Telegram is not skipped.
  cron.schedule(
    dailyExpression,
    () => {
      logger.info("Daily brief cron fired", {
        iranNow: `${getIranDateString()} ${formatIranClock()}`,
        force: true,
      });
      runSafely("daily-cron", runDailySetup, { force: true }).catch((error) => {
        logger.error("Scheduled daily setup failed", {
          error: error.message,
          stack: error.stack,
        });
      });
    },
    { timezone: IRAN_TZ },
  );

  logger.info("Daily brief cron armed", {
    expression: dailyExpression,
    timezone: IRAN_TZ,
    forceOnTick: true,
  });

  if (scenarioCheckEnabled) {
    cron.schedule(
      scenarioCheckCron,
      () => {
        logger.info("8h scenario check cron fired", {
          iranNow: `${getIranDateString()} ${formatIranClock()}`,
        });
        runSafely("scenario-cron", runScenarioCheck, { force: false }).catch((error) => {
          logger.error("Scheduled scenario check failed", {
            error: error.message,
            stack: error.stack,
          });
        });
      },
      { timezone: IRAN_TZ },
    );
    logger.info("8h scenario check cron armed", {
      expression: scenarioCheckCron,
      timezone: IRAN_TZ,
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
    logger.info("Intraday monitoring disabled (daily setup chart only)");
  }
}

main().catch(async (error) => {
  logger.error("Fatal error", { error: error.message, stack: error.stack });
  await closeDb();
  process.exit(1);
});
