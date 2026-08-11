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

export function parseStrictJsonOutput(payload) {
  const values = [payload?.outputs, payload?.output, payload?.result, payload?.data].flatMap((value) => Array.isArray(value) ? value : [value]);
  const text = values.find((value) => typeof value === "string") || values.find((value) => typeof value?.text === "string")?.text;
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Provider output did not include structured JSON");
  return JSON.parse(match[0]);
}
