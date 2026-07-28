const assert = require("node:assert/strict");
const { isPastIranDailyBriefTime, getIranParts } = require("../services/timeIran");

// Construct a Date that formats as a known Iran local time is hard without fixed offset.
// Validate the helper against current clock parts: if Iran hour>=4, must be past; if hour<3, must be before.
const now = new Date();
const parts = getIranParts(now);
const past = isPastIranDailyBriefTime(now);
if (parts.hour > 3 || (parts.hour === 3 && parts.minute >= 30)) {
  assert.equal(past, true);
} else {
  assert.equal(past, false);
}

assert.equal(typeof isPastIranDailyBriefTime(), "boolean");
console.log("time iran brief helper tests passed");
