const crypto = require("node:crypto");

function normalizeResearchText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}

/**
 * Only trust explicit CoinEx AI Research timestamps.
 * Do NOT match random news datetimes — that can freeze dedupe forever.
 */
function extractResearchUpdatedAt(text) {
  const patterns = [
    /\bTime:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\b/i,
    /زمان\s*[:：]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i,
    /Updated(?:\s*at)?\s*[:：]?\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function buildContentFingerprint(text) {
  const normalized = normalizeResearchText(text);
  const sourceUpdatedAt = extractResearchUpdatedAt(text);
  const contentHash = crypto.createHash("sha256").update(normalized).digest("hex");

  return {
    normalized,
    sourceUpdatedAt,
    contentHash,
  };
}

/**
 * Skip only when the research body itself is unchanged.
 * Matching Time alone is NOT enough (wrong/stable timestamps must not block sends).
 */
function isSameResearch(latestContent, fingerprint) {
  if (!latestContent?.text_hash || !fingerprint?.contentHash) {
    return false;
  }

  return latestContent.text_hash === fingerprint.contentHash;
}

module.exports = {
  buildContentFingerprint,
  extractResearchUpdatedAt,
  isSameResearch,
  normalizeResearchText,
};
