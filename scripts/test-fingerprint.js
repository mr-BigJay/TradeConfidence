const assert = require("node:assert/strict");
const {
  buildContentFingerprint,
  extractResearchUpdatedAt,
  isSameResearch,
} = require("../services/contentFingerprint");

const sampleA = `
Time: 2026-07-25 01:00
Market News
Event happened on 2026-07-23 10:00 UTC about regulation.
BTC support 63700
`;

const sampleB = `
Time: 2026-07-25 02:00
Market News
Event happened on 2026-07-23 10:00 UTC about regulation.
BTC support 62000
`;

assert.equal(extractResearchUpdatedAt(sampleA), "2026-07-25 01:00");
assert.notEqual(extractResearchUpdatedAt(sampleA), "2026-07-23 10:00");

const fpA = buildContentFingerprint(sampleA);
const fpB = buildContentFingerprint(sampleB);

assert.equal(
  isSameResearch(
    { text_hash: fpA.contentHash, source_updated_at: "2026-07-23 10:00" },
    fpB,
  ),
  false,
  "different body must not skip even if a stale timestamp matches",
);

assert.equal(
  isSameResearch({ text_hash: fpA.contentHash, source_updated_at: fpA.sourceUpdatedAt }, fpA),
  true,
);

assert.equal(
  isSameResearch({ text_hash: fpA.contentHash, source_updated_at: fpA.sourceUpdatedAt }, fpB),
  false,
);

console.log("fingerprint tests passed");
