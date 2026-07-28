/**
 * Delivery reliability helpers for the morning brief and 8h checks.
 */

const { getDailySetupByIranDate, getRecentEvents } = require("../database/db");
const { getIranDateString, isPastIranDailyBriefTime, getIranParts } = require("./timeIran");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(fn, { retries = 3, baseDelayMs = 1500, label = "operation" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const delay = baseDelayMs * attempt;
      await sleep(delay);
    }
  }
  const err = lastError || new Error(`${label} failed`);
  err.retries = retries;
  throw err;
}

function planHasTelegramDelivery(plan) {
  if (!plan) return false;
  if (plan.setup?.telegram_sent === true) return true;
  if (Array.isArray(plan.setup?.telegram_message_ids) && plan.setup.telegram_message_ids.length) {
    return true;
  }
  return false;
}

async function hasDailyBriefDelivery(symbol, iranDate = getIranDateString()) {
  const plan = await getDailySetupByIranDate(symbol, iranDate);
  if (planHasTelegramDelivery(plan)) return { delivered: true, plan, via: "setup_json" };

  const events = await getRecentEvents(symbol, 40);
  const hit = events.find(
    (item) =>
      item.event === "daily_setup_success" &&
      String(item.message || "").includes(iranDate),
  );
  const telegram = events.find(
    (item) =>
      item.event === "telegram_success" &&
      /Daily plan telegram/i.test(String(item.message || "")),
  );
  if (hit && telegram) {
    return { delivered: true, plan, via: "events" };
  }
  return { delivered: false, plan, via: null };
}

/**
 * After 03:30, morning brief must exist AND have been sent to Telegram.
 */
async function needsMorningBriefCatchUp(symbol, now = new Date()) {
  if (!isPastIranDailyBriefTime(now)) {
    return { needed: false, reason: "before_brief_time" };
  }
  const iranDate = getIranDateString(now);
  const status = await hasDailyBriefDelivery(symbol, iranDate);
  if (!status.delivered) {
    return {
      needed: true,
      reason: status.plan ? "plan_exists_but_telegram_missing" : "plan_missing",
      iranDate,
      plan: status.plan,
    };
  }
  return { needed: false, reason: "already_delivered", iranDate, plan: status.plan };
}

/**
 * True in the post-03:30 safety window where a missed brief should be force-sent.
 * Default: 03:35 → 04:30 Iran.
 */
function isMorningDeliveryWatchWindow(now = new Date()) {
  const p = getIranParts(now);
  if (p.hour === 3 && p.minute >= 35) return true;
  if (p.hour === 4 && p.minute <= 30) return true;
  return false;
}

async function countRecentErrors(symbol, limit = 10) {
  const events = await getRecentEvents(symbol, limit);
  return events.filter((item) => /error|fail/i.test(item.event)).length;
}

module.exports = {
  sleep,
  withRetries,
  planHasTelegramDelivery,
  hasDailyBriefDelivery,
  needsMorningBriefCatchUp,
  isMorningDeliveryWatchWindow,
  countRecentErrors,
};
