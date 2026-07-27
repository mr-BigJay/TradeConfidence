const config = require("../config/config");
const {
  getDailySetupByIranDate,
  saveDailySetup,
  saveEvent,
} = require("../database/db");
const logger = require("../logger");
const { collectMarketBundle } = require("./marketBundle");
const { scoreMarketBundle } = require("./engines/scoringEngine");
const { createDailyTradingPlan } = require("./openaiTradingPlan");
const { sendDailyTradingPlan } = require("./telegram");
const {
  renderDailySetupChart,
  formatSetupChartCaption,
} = require("./setupChartImage");
const { getIranDateString, nextIranDailyCutoffIso } = require("./timeIran");

async function runDailySetup(options = {}) {
  const results = [];
  logger.info("Start daily trading plan pipeline");
  await saveEvent({ event: "daily_setup_start", message: "Start daily trading plan pipeline" });

  for (const symbol of config.coinex.symbols) {
    const result = { symbol, ok: false, mode: "daily_trading_plan" };
    try {
      const iranDate = getIranDateString();
      const existing = await getDailySetupByIranDate(symbol, iranDate);

      if (existing && !options.force) {
        logger.info("Daily trading plan already exists; skipping", { symbol, iranDate });
        await saveEvent({
          symbol,
          event: "daily_setup_skip",
          message: `Plan already exists for ${iranDate}`,
        });
        result.ok = true;
        result.skipped = true;
        result.reason = "already_exists";
        results.push(result);
        continue;
      }

      const marketBundle = await collectMarketBundle(symbol, {
        includeResearch: true,
        period: "1h",
      });
      const engineScore = scoreMarketBundle(marketBundle);
      const validation = engineScore.validation;

      if (!marketBundle.coinex?.available) {
        logger.warn("CoinEx narrative missing; plan will rely more on market data", { symbol });
      }
      if (!marketBundle.futures?.available) {
        logger.warn("Binance futures unavailable; confidence will be capped by coverage", {
          symbol,
          geoBlocked: marketBundle.futures?.geoBlocked,
        });
      }

      const plan = await createDailyTradingPlan({
        symbol,
        marketBundle,
        engineScore,
        validation,
      });

      // Prefer engine validation status if model drifts.
      plan.coinex_validation_status =
        plan.coinex_validation_status || validation.status || "Partially Confirmed";

      const createdAt = new Date().toISOString();

      let chartImagePath = null;
      try {
        chartImagePath = await renderDailySetupChart(plan, { iranDate });
      } catch (error) {
        logger.warn("Daily setup chart render failed; sending text only", {
          symbol,
          error: error.message,
        });
      }

      const telegramResults = await sendDailyTradingPlan(plan, {
        iranDate,
        validation,
        engineScore,
        chartImagePath,
        chartCaption: formatSetupChartCaption(plan, { iranDate }),
      });
      const messageIds = telegramResults
        .map((item) => item?.result?.message_id)
        .filter(Boolean);
      logger.info("Telegram daily plan sent", {
        symbol,
        chunks: telegramResults.length,
        messageIds,
        chartImagePath: chartImagePath || null,
        chatId: config.telegram.chatId,
      });

      const saved = await saveDailySetup({
        symbol,
        iran_date: iranDate,
        created_at: createdAt,
        valid_until: nextIranDailyCutoffIso(new Date()),
        direction: plan.direction,
        bias: plan.bias,
        confidence: plan.confidence,
        market_score: plan.market_score,
        risk_level: plan.risk_level,
        risk_notes: (plan.risk_warnings || []).join(" | "),
        entry: plan.entry,
        stop_loss: plan.stop_loss,
        tp1: plan.tp1,
        tp2: plan.tp2,
        tp3: plan.tp3,
        supports: plan.supports,
        resistances: plan.resistances,
        setup: {
          ...plan,
          engineScore,
          validation,
          marketBundleSummary: {
            coinexAvailable: marketBundle.coinex?.available,
            binanceAvailable: marketBundle.futures?.available,
            deribitAvailable: marketBundle.options?.available,
            bitunixAvailable: marketBundle.execution?.available,
            chartAvailable: marketBundle.chart?.available,
            chartSetup: marketBundle.chart?.setup || null,
            topPattern: marketBundle.chart?.top_pattern || null,
            executionCompare: marketBundle.execution?.compare || null,
            setupChartImage: chartImagePath || null,
          },
        },
        bitunix_snapshot: {
          binance: marketBundle.futures?.raw || null,
          deribit: marketBundle.options?.raw || null,
          bitunix: marketBundle.execution?.raw || null,
          chart: marketBundle.chart || null,
        },
        status: "Active",
      });

      await saveEvent({
        symbol,
        event: "telegram_success",
        message: `Daily plan telegram message_ids=${messageIds.join(",") || "n/a"}`,
      });
      await saveEvent({
        symbol,
        event: "daily_setup_success",
        message: `Trading plan ${iranDate} bias=${plan.bias} conf=${plan.confidence} validation=${plan.coinex_validation_status}`,
      });

      result.ok = true;
      result.plan = saved;
      results.push(result);
    } catch (error) {
      logger.error("Daily trading plan failed", {
        symbol,
        error: error.message,
        stack: error.stack,
      });
      await saveEvent({ symbol, event: "daily_setup_error", message: error.message });
      result.error = error.message;
      results.push(result);
    }
  }

  logger.info("Finish daily trading plan pipeline", { results });
  await saveEvent({
    event: "daily_setup_finish",
    message: JSON.stringify(
      results.map(({ symbol, ok, skipped, error }) => ({ symbol, ok, skipped, error })),
    ),
  });
  return results;
}

module.exports = {
  runDailySetup,
};
