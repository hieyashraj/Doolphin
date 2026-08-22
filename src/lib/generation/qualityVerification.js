export function normalizeTranscript(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordErrorRate(expected, actual) {
  const left = normalizeTranscript(expected).split(" ").filter(Boolean);
  const right = normalizeTranscript(actual).split(" ").filter(Boolean);
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
  }
  return left.length ? matrix[left.length][right.length] / left.length : (right.length ? 1 : 0);
}

export function transcriptPasses(expected, actual) {
  const expectedNormalized = normalizeTranscript(expected);
  const actualNormalized = normalizeTranscript(actual);
  const errorRate = wordErrorRate(expected, actual);
  return {
    passed: expectedNormalized === actualNormalized || errorRate <= 0.08,
    expectedNormalized,
    actualNormalized,
    wordErrorRate: errorRate
  };
}

function parseJsonText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch {}
  }
  const objectText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!objectText) return null;
  try { return JSON.parse(objectText); } catch { return null; }
}

function findStructuredOutput(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") return findStructuredOutput(parseJsonText(value), depth + 1);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredOutput(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (["hasDistortion", "has_distortion", "severeDistortion", "isProductVideo", "isAppVideo", "isSoftwareVideo", "isRelevant"].some((key) => key in value)) {
    return value;
  }
  for (const key of ["outputs", "output", "result", "data", "text", "content", "response"]) {
    if (key in value) {
      const found = findStructuredOutput(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function parseStrictJsonOutput(payload) {
  const parsed = findStructuredOutput(payload);
  if (!parsed) throw new Error("Provider output did not include structured JSON");
  const hasDistortion = parsed.hasDistortion ?? parsed.has_distortion ?? parsed.severeDistortion;
  if (typeof hasDistortion !== "boolean") throw new Error("Provider output has an invalid distortion verdict");
  for (const key of ["isProductVideo", "isAppVideo", "isSoftwareVideo", "isRelevant"]) {
    if (key in parsed && typeof parsed[key] !== "boolean") throw new Error(`Provider output has an invalid ${key} verdict`);
  }
  return {
    ...parsed,
    hasDistortion,
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
  };
}

export function buildVisionVerificationPrompt(studio, title = "") {
  const safeTitle = String(title || "").replace(/[\r\n]+/g, " ").slice(0, 200);
  if (studio === "PRODUCT_STUDIO") {
    return `Analyze this video verification montage for \"${safeTitle}\". Decide whether it is relevant to a product advertisement or product-focused UGC, and whether any frame has severe visual distortion or glitches. Return only JSON: {\"isProductVideo\": boolean, \"hasDistortion\": boolean, \"summary\": string}`;
  }
  if (studio === "APP_STUDIO") {
    return `Analyze this video verification montage for \"${safeTitle}\". Decide whether it is relevant to an app, software product, or software workflow, and whether any frame has severe visual distortion or glitches. Return only JSON: {\"isAppVideo\": boolean, \"hasDistortion\": boolean, \"summary\": string}`;
  }
  return `Analyze this video verification montage for \"${safeTitle}\". Check only for severe visual distortion, corrupted imagery, or glitched frames; do not require product, UGC, app, or software content. Return only JSON: {\"hasDistortion\": boolean, \"summary\": string}`;
}

export function evaluateVisionVerification(studio, analysis) {
  const hasDistortion = analysis?.hasDistortion;
  if (typeof hasDistortion !== "boolean") return { passed: false, relevancePassed: false, hasDistortion: null };
  if (studio === "VIDEO_STUDIO") return { passed: !hasDistortion, relevancePassed: true, hasDistortion };

  let relevance;
  if (studio === "APP_STUDIO") {
    relevance = analysis.isAppVideo ?? analysis.isSoftwareVideo ?? analysis.isRelevant;
    // Compatibility for verifier jobs already in flight under the old shared
    // product/UGC prompt. New App jobs use isAppVideo above.
    if (relevance === undefined) relevance = analysis.isProductVideo;
  } else {
    relevance = analysis.isProductVideo ?? analysis.isRelevant;
  }
  const relevancePassed = relevance === true;
  return { passed: relevancePassed && !hasDistortion, relevancePassed, hasDistortion };
}
