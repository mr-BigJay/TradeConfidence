const IRAN_TZ = "Asia/Tehran";

function getIranParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IRAN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    date: `${map.year}-${map.month}-${map.day}`,
  };
}

function getIranDateString(date = new Date()) {
  return getIranParts(date).date;
}

function getIranDateDaysAgo(days = 1, fromDate = new Date()) {
  const ms = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
  return getIranDateString(new Date(fromDate.getTime() - ms));
}

function formatIranClock(date = new Date()) {
  const p = getIranParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * True once today's 03:30 Asia/Tehran brief time has passed (inclusive).
 * Used so boot catch-up does not create a plan before the daily candle close.
 */
function isPastIranDailyBriefTime(date = new Date(), hour = 3, minute = 30) {
  const p = getIranParts(date);
  if (p.hour > hour) return true;
  if (p.hour === hour && p.minute >= minute) return true;
  return false;
}

/**
 * Next 03:30 Asia/Tehran after the given moment, as UTC ISO.
 * Used as valid_until for a daily setup.
 */
function nextIranDailyCutoffIso(fromDate = new Date()) {
  const parts = getIranParts(fromDate);
  // Construct "today 03:30 Iran" and "tomorrow 03:30 Iran" via iterative search.
  // Safer than manual offset math around edge cases.
  let cursor = new Date(fromDate.getTime());
  for (let i = 0; i < 48 * 60; i += 1) {
    cursor = new Date(fromDate.getTime() + i * 60 * 1000);
    const p = getIranParts(cursor);
    if (p.hour === 3 && p.minute === 30) {
      if (cursor > fromDate) {
        return cursor.toISOString();
      }
    }
  }

  // Fallback: +24h
  return new Date(fromDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  IRAN_TZ,
  getIranParts,
  getIranDateString,
  getIranDateDaysAgo,
  formatIranClock,
  isPastIranDailyBriefTime,
  nextIranDailyCutoffIso,
};
