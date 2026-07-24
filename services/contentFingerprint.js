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

function extractResearchUpdatedAt(text) {
  const patterns = [
    /Time:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i,
    /زمان\s*[:：]?\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i,
    /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*(?:UTC)?/i,
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

function isSameResearch(latestContent, fingerprint) {
  if (!latestContent) {
    return false;
  }

  if (
    fingerprint.sourceUpdatedAt &&
    latestContent.source_updated_at &&
    fingerprint.sourceUpdatedAt === latestContent.source_updated_at
  ) {
    return true;
  }

  return latestContent.text_hash === fingerprint.contentHash;
}

module.exports = {
  buildContentFingerprint,
  extractResearchUpdatedAt,
  isSameResearch,
  normalizeResearchText,
};
