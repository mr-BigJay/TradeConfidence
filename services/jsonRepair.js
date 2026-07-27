function stripCodeFences(content) {
  return String(content || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function balanceBrackets(text) {
  let out = "";
  const stack = [];

  for (const ch of text) {
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      out += ch;
      continue;
    }

    if (ch === "}" || ch === "]") {
      const expected = ch === "}" ? "{" : "[";
      while (stack.length && stack[stack.length - 1] !== expected) {
        const open = stack.pop();
        out += open === "{" ? "}" : "]";
      }
      if (stack.length && stack[stack.length - 1] === expected) {
        stack.pop();
        out += ch;
      }
      // Drop unmatched closing brackets.
      continue;
    }

    out += ch;
  }

  while (stack.length) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }

  return out;
}

function repairJsonText(content) {
  let text = stripCodeFences(content);
  const start = text.indexOf("{");
  if (start < 0) {
    return text;
  }
  text = text.slice(start);

  // Replace smart quotes
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, "$1");

  // Close / balance brackets for truncated model output
  text = balanceBrackets(text);
  text = text.replace(/,\s*([}\]])/g, "$1");

  return text;
}

function tryParseJson(content) {
  const attempts = [stripCodeFences(content), repairJsonText(content)];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  const err = new Error(
    `Invalid JSON from model: ${lastError?.message || "parse failed"}. Preview: ${String(content).slice(0, 240)}`,
  );
  err.cause = lastError;
  throw err;
}

module.exports = {
  stripCodeFences,
  repairJsonText,
  tryParseJson,
  balanceBrackets,
};
