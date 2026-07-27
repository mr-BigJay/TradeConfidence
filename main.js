const cron = require("node-cron");
const config = require("./config/config");
const { closeDb } = require("./database/db");
const logger = require("./logger");
const { runDailySetup } = require("./services/dailySetupPipeline");
const { runIntradayMonitor } = require("./services/intradayPipeline");
const { IRAN_TZ } = require("./services/timeIran");

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

  // Legacy scrape-only kept for diagnostics.
  if (args.has("--scrape-only")) {
    const { runPipeline } = require("./services/pipeline");
    await runSafely("scrape", runPipeline, { scrapeOnly: true, force: options.force });
    await closeDb();
    return;
  }

  const dailyExpression = config.scheduler.dailyCron;
  const intradayEnabled = Boolean(config.scheduler.intradayEnabled);

  logger.info("Starting BTC Advanced Market Intelligence Engine", {
    dailyCron: dailyExpression,
    timezone: IRAN_TZ,
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

  // On boot: create today's plan once if missing. No intraday loop by default.
  await runSafely("daily-boot", runDailySetup, { force: false });

  cron.schedule(
    dailyExpression,
    () => {
      runSafely("daily", runDailySetup, { force: false }).catch((error) => {
        logger.error("Scheduled daily setup failed", {
          error: error.message,
          stack: error.stack,
        });
      });
    },
    { timezone: IRAN_TZ },
  );

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
