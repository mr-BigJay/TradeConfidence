const cron = require("node-cron");
const config = require("./config/config");
const { closeDb } = require("./database/db");
const logger = require("./logger");
const { runPipeline } = require("./services/pipeline");

const args = new Set(process.argv.slice(2));
let isRunning = false;

function buildCronExpression(intervalMinutes) {
  if (intervalMinutes < 1 || intervalMinutes > 59) {
    throw new Error("CHECK_INTERVAL_MINUTES must be between 1 and 59");
  }

  return `*/${intervalMinutes} * * * *`;
}

async function runSafely(options = {}) {
  if (isRunning) {
    logger.warn("Previous pipeline run is still active, skipping this tick");
    return;
  }

  isRunning = true;
  try {
    await runPipeline(options);
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
    scrapeOnly: args.has("--scrape-only"),
    force: args.has("--force"),
  };

  if (args.has("--once")) {
    await runSafely(options);
    await closeDb();
    return;
  }

  const expression = buildCronExpression(config.scheduler.intervalMinutes);

  logger.info("Starting scheduled CoinEx AI Research bot", {
    intervalMinutes: config.scheduler.intervalMinutes,
    symbols: config.coinex.symbols,
  });

  await runSafely(options);

  cron.schedule(expression, () => {
    runSafely(options).catch((error) => {
      logger.error("Scheduled run failed", { error: error.message, stack: error.stack });
    });
  });
}

main().catch(async (error) => {
  logger.error("Fatal error", { error: error.message, stack: error.stack });
  await closeDb();
  process.exit(1);
});
