const assert = require("node:assert/strict");
const { tryParseJson } = require("../services/jsonRepair");

const broken = `{
  "bias": "Bullish",
  "execution_notes": ["one", "two",],
  "supports": ["1", "2"
}`;

const parsed = tryParseJson(broken);
assert.equal(parsed.bias, "Bullish");
assert.deepEqual(parsed.execution_notes, ["one", "two"]);
assert.ok(Array.isArray(parsed.supports));

const fenced = "```json\n{\"a\":1}\n```";
assert.equal(tryParseJson(fenced).a, 1);

console.log("json repair tests passed");
