import test from "node:test";
import assert from "node:assert/strict";
import { formatCreationElapsed } from "../src/lib/generation/recoveryDisplay.js";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

test("new and recent creations show bounded elapsed labels", () => {
  assert.equal(formatCreationElapsed({ createdAt: new Date(NOW - 30_000).toISOString() }, NOW), "Just started");
  assert.equal(formatCreationElapsed({ createdAt: new Date(NOW - 12 * 60_000).toISOString() }, NOW), "12m elapsed");
});

test("hour-old creations never expose misleading multi-hour elapsed minutes", () => {
  assert.equal(formatCreationElapsed({
    createdAt: new Date(NOW - 61 * 60_000).toISOString(),
    timeoutAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
  }, NOW), "Recovery delayed");
});

test("expired server deadlines and malformed timestamps fail to safe labels", () => {
  assert.equal(formatCreationElapsed({ createdAt: new Date(NOW - 5 * 60_000).toISOString(), timeoutAt: new Date(NOW - 1).toISOString() }, NOW), "Recovery delayed");
  assert.equal(formatCreationElapsed({ createdAt: "invalid", timeoutAt: "invalid" }, NOW), "Just started");
});
