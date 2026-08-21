import test from "node:test";
import assert from "node:assert/strict";
import { isDisposableEmailDomain, emailDomainOf, DISPOSABLE_EMAIL_DOMAINS } from "../src/lib/access/disposable-email.js";
import { enforceRateLimit } from "../src/lib/access/rate-limit.js";

// --- Disposable email detection --------------------------------------------

test("disposable-email: well-known throwaway providers are blocked", () => {
  for (const email of [
    "spammer@mailinator.com",
    "x@guerrillamail.com",
    "y@10minutemail.com",
    "z@yopmail.com",
    "a@temp-mail.org",
    "b@trashmail.com",
    "c@1secmail.com",
    "qa@tempmail.local",
  ]) {
    assert.equal(isDisposableEmailDomain(email), true, `${email} must be blocked`);
  }
});

test("disposable-email: subdomains of throwaway providers are also blocked", () => {
  assert.equal(isDisposableEmailDomain("user@inbox.mailinator.com"), true);
  assert.equal(isDisposableEmailDomain("user@a.b.guerrillamail.com"), true);
});

test("disposable-email: real providers and business domains are allowed", () => {
  for (const email of [
    "founder@gmail.com",
    "team@doolphin.co",
    "person@outlook.com",
    "dev@company.io",
    "someone@icloud.com",
    "buyer@example.com",
  ]) {
    assert.equal(isDisposableEmailDomain(email), false, `${email} must be allowed`);
  }
});

test("disposable-email: a whole TLD is never blocked by accident", () => {
  // "com" alone must never match even though many blocked domains end in .com
  assert.equal(isDisposableEmailDomain("real@notdisposable.com"), false);
  assert.equal(emailDomainOf("Real@Notdisposable.COM"), "notdisposable.com");
});

test("disposable-email: malformed input is treated as non-disposable (fails open to the neutral path)", () => {
  assert.equal(isDisposableEmailDomain(""), false);
  assert.equal(isDisposableEmailDomain("no-at-sign"), false);
  assert.equal(isDisposableEmailDomain(null), false);
  assert.ok(DISPOSABLE_EMAIL_DOMAINS.size > 50, "curated list should be substantial");
});

// --- Rate limiting ----------------------------------------------------------

function createRateLimitDb() {
  const rows = new Map();
  const key = (w) => `${w.scope}|${w.subjectHash}|${w.windowStartsAt.getTime()}`;
  return {
    authRateLimit: {
      upsert: async ({ where, update, create }) => {
        const k = key(where.scope_subjectHash_windowStartsAt);
        const existing = rows.get(k);
        if (existing) {
          existing.attempts += update.attempts.increment;
          return existing;
        }
        const row = { ...create };
        rows.set(k, row);
        return row;
      },
    },
  };
}

test("rate-limit: allows up to the limit then throws 429", async () => {
  const db = createRateLimitDb();
  const call = () => enforceRateLimit({ scope: "signup", subject: "1.2.3.4:a@b.com", limit: 5, windowMs: 3600000 }, db);
  for (let i = 0; i < 5; i += 1) await call(); // attempts 1..5 are allowed
  await assert.rejects(call, (e) => e.status === 429); // 6th exceeds
});

test("rate-limit: distinct subjects are counted independently", async () => {
  const db = createRateLimitDb();
  await enforceRateLimit({ scope: "signup", subject: "ip:one@x.com", limit: 1, windowMs: 3600000 }, db);
  // A different subject in the same scope is unaffected by the first's count.
  await assert.doesNotReject(
    enforceRateLimit({ scope: "signup", subject: "ip:two@x.com", limit: 1, windowMs: 3600000 }, db)
  );
});

test("rate-limit: the per-IP scope caps enumeration across many emails", async () => {
  const db = createRateLimitDb();
  const perIp = () => enforceRateLimit({ scope: "signup-ip", subject: "9.9.9.9", limit: 20, windowMs: 3600000 }, db);
  for (let i = 0; i < 20; i += 1) await perIp();
  await assert.rejects(perIp, (e) => e.status === 429);
});
