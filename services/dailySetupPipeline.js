const config = require("../config/config");
const {
  getDailySetupByIranDate,
  saveDailySetup,
  saveEvent,
  saveSetupEvaluation,
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
const { ensureTradingPlanLevels } = require("./ensurePlanLevels");
const { getIranDateString, getIranDateDaysAgo, nextIranDailyCutoffIso } = require("./timeIran");
const { evaluateOutlookHit } = require("./dayOutlook");

async function evaluatePreviousDayOutlook(symbol, marketBundle, iranDate) {
  try {
    const yesterday = getIranDateDaysAgo(1);
    const previous = await getDailySetupByIranDate(symbol, yesterday);
    if (!previous) return null;

    const previousOutlook =
      previous.setup?.day_outlook_full ||
      previous.setup?.engineScore?.day_outlook ||
      {
        expected_day_candle: previous.setup?.day_outlook,
        day_outlook: previous.setup?.day_outlook,
      };

    const closed =
      marketBundle.chart?.day_outlook?.closed_candle ||
      null;
    const result = evaluateOutlookHit(previousOutlook, closed);
    result.previous_iran_date = yesterday;
    result.current_iran_date = iranDate;

    if (previous.id) {
      await saveSetupEvaluation({
        setup_id: previous.id,
        symbol,
        created_at: new Date().toISOString(),
        setup_status: result.status === "hit" ? "Active" : result.status === "miss" ? "Weakening" : "Active",
        confidence: previous.confidence,
        market_score: previous.market_score,
        rationale: result.note_fa,
        evaluation: {
          type: "day_outlook_feedback",
          ...result,
        },
        telegram_sent: false,
      });
    }

    await saveEvent({
      symbol,
      event: "day_outlook_feedback",
      message: `${yesterday} predicted=${result.predicted} actual=${result.actual} status=${result.status}`,
    });

    return result;
  } catch (error) {
    logger.warn("Previous day outlook evaluation failed", { symbol, error: error.message });
    return null;
  }
}

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
        logger.info("Daily trading plan already exists; skipping", {
          symbol,
          iranDate,
          hint: "Scheduled 03:30 cron uses force=true; boot catch-up skips duplicates",
        });
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
      const previousOutlookResult = await evaluatePreviousDayOutlook(
        symbol,
        marketBundle,
        iranDate,
      );
      if (previousOutlookResult) {
        engineScore.previous_outlook_result = previousOutlookResult;
      }

      if (!marketBundle.coinex?.available) {
        logger.warn("CoinEx narrative missing or stale; plan will rely more on market data", {
          symbol,
          error: marketBundle.coinex?.error || null,
          fromCache: Boolean(marketBundle.coinex?.fromCache),
          stale: Boolean(marketBundle.coinex?.stale),
        });
      } else {
        logger.info("CoinEx narrative attached to daily plan", {
          symbol,
          length: marketBundle.coinex.text.length,
          fromCache: Boolean(marketBundle.coinex.fromCache),
          url: marketBundle.coinex.url,
        });
      }
      if (!marketBundle.futures?.available) {
        logger.warn("Binance futures unavailable; confidence will be capped by coverage", {
          symbol,
          geoBlocked: marketBundle.futures?.geoBlocked,
        });
      }

      logger.info("Day candle outlook ready", {
        symbol,
        closed: engineScore.day_outlook?.closed_candle?.color_fa,
        next: engineScore.day_outlook?.expected_day_candle_fa,
        confidence: engineScore.day_outlook?.confidence,
        previousFeedback: previousOutlookResult?.status || null,
      });

      let plan = await createDailyTradingPlan({
        symbol,
        marketBundle,
        engineScore,
        validation,
      });

      // Prefer engine validation status if model drifts.
      plan.coinex_validation_status =
        plan.coinex_validation_status || validation.status || "Partially Confirmed";

      // Hard guarantee: never send نامشخص Entry/TP/SL when price/S/R exist.
      plan = ensureTradingPlanLevels(plan, engineScore, marketBundle);

      // Final stance lock (GPT cannot invent LONG/SHORT without trade_allowed).
      if (!engineScore.chart_setup?.trade_allowed) {
        plan.direction = "RANGE";
        plan.trade_allowed = false;
        plan.monitoring_only = true;
        plan.bias = engineScore.bias || plan.bias || "Neutral";
        plan.confidence = engineScore.confidence ?? plan.confidence;
      } else {
        plan.direction = engineScore.chart_setup.direction;
        plan.trade_allowed = true;
        plan.monitoring_only = false;
        plan.bias = plan.direction === "LONG" ? "Bullish" : "Bearish";
      }

      // Primary product signal: next daily candle color.
      plan.day_outlook = engineScore.day_outlook?.expected_day_candle || plan.day_outlook || "neutral";
      plan.day_outlook_fa =
        engineScore.day_outlook?.expected_day_candle_fa || plan.day_outlook_fa || "خنثی";
      plan.day_outlook_confidence =
        engineScore.day_outlook?.confidence ?? plan.day_outlook_confidence ?? plan.confidence;
      plan.day_outlook_summary =
        engineScore.day_outlook?.summary_fa || plan.day_outlook_summary || "";
      plan.day_outlook_reasons = engineScore.day_outlook?.reasons || [];
      plan.closed_daily_candle = engineScore.day_outlook?.closed_candle || null;
      plan.previous_outlook_result = previousOutlookResult;
      plan.day_outlook_full = engineScore.day_outlook || null;

      logger.info("Daily plan levels ensured", {
        symbol,
        bias: plan.bias,
        direction: plan.direction,
        dayOutlook: plan.day_outlook_fa,
        tradeAllowed: Boolean(plan.trade_allowed),
        entry: plan.entry,
        stopLoss: plan.stop_loss,
        tp1: plan.tp1,
        tp2: plan.tp2,
        tp3: plan.tp3,
        riskReward: plan.risk_reward,
      });

      const createdAt = new Date().toISOString();
      const replacing = Boolean(existing && options.force);

      let chartImagePath = null;
      try {
        chartImagePath = await renderDailySetupChart(plan, { iranDate });
      } catch (error) {
        logger.warn("Daily setup chart render failed; sending text only", {
          symbol,
          error: error.message,
        });
      }

      const chartCaption = formatSetupChartCaption(plan, {
        iranDate,
        engineScore,
        replacing,
      });

      const telegramResults = await sendDailyTradingPlan(plan, {
        iranDate,
        validation,
        engineScore,
        chartImagePath,
        chartCaption,
        replacing,
      });
      const messageIds = telegramResults
        .map((item) => item?.result?.message_id)
        .filter(Boolean);
      if (!messageIds.length) {
        throw new Error("Telegram daily plan returned no message_ids");
      }
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
          telegram_sent: true,
          telegram_message_ids: messageIds,
          telegram_sent_at: new Date().toISOString(),
          marketBundleSummary: {
            coinexAvailable: marketBundle.coinex?.available,
            coinexStale: Boolean(marketBundle.coinex?.stale),
            binanceAvailable: marketBundle.futures?.available,
            deribitAvailable: marketBundle.options?.available,
            bitunixAvailable: marketBundle.execution?.available,
            chartAvailable: marketBundle.chart?.available,
            chartSetup: marketBundle.chart?.setup || null,
            topPattern: marketBundle.chart?.top_pattern || null,
            dayOutlook: engineScore.day_outlook || null,
            previousOutlookResult,
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
        message: `Trading plan ${iranDate} bias=${plan.bias} day=${plan.day_outlook_fa} conf=${plan.confidence} validation=${plan.coinex_validation_status}`,
      });

      result.ok = true;
      result.plan = saved;
      result.day_outlook = plan.day_outlook;
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
      results.map(({ symbol, ok, skipped, error, day_outlook }) => ({
        symbol,
        ok,
        skipped,
        error,
        day_outlook,
      })),
    ),
  });
  return results;
}

module.exports = {
  runDailySetup,
  evaluatePreviousDayOutlook,
};
