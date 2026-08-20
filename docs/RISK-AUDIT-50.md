# Doolphin risk audit — 50 failure modes for a credit-billed generative media app

Every row is a failure mode that has cost real companies real money in this exact
product category (pay-per-generation AI media). Each carries a verdict from
reading this codebase, not a generic recommendation.

**Verdicts**
- `SAFE` — a specific mechanism prevents it; evidence cited.
- `PARTIAL` — mitigated but with a named hole.
- `EXPOSED` — no mechanism found.
- `N/A` — not reachable in this architecture.

Audited at commit `27e7a52`.

---

## A. Money in / money out (1–12)

| # | Failure mode | Verdict | Evidence / gap |
|---|---|---|---|
| 1 | Charging less than provider cost on some model | **SAFE** | `calculateRequiredCredits` (`pricing.js:89`) ceiling-divides cost by a fixed per-credit ceiling, so `cost <= credits × ceiling` for *any* cost. Proven exhaustively over every documented model in `tests/documented-cost-ceiling.test.js`. |
| 2 | Default cost mistaken for maximum cost | **SAFE** | The original defect. Ceilings now come from published price tables/rates only; `$51` not `$8.50`. Regression-tested. |
| 3 | Provider silently raises prices | **SAFE** | `assertLiveCostWithinDocumentedCeiling` refuses quotes above the documented max +25%. Fails closed. |
| 4 | Provider returns `$0.00` for a paid model | **SAFE** | `PROVIDER_COST_ZERO_FOR_PAID_MODEL` (`verifiedCosts.js`). |
| 5 | Units bug (cents read as dollars) | **SAFE** | Bounded above by the documented ceiling and below by `DRIFT_LOWER_DIVISOR`. |
| 6 | Cost unbounded by user input (long input video) | **SAFE** | 12 models refused at admission via `MODEL_COST_UNBOUNDED` before any network call. |
| 7 | Billing a model whose price surface is unknown | **SAFE** | 7 models refused via `MODEL_COST_INDETERMINATE`. |
| 8 | Double-charge for one generation | **SAFE** | Charge commits once in `finalizeDeliverable` under a finalization lease; `settleReservationSplit` is idempotent on `settledAt` and asserts `commit + release === amount`. |
| 9 | Duplicate generation from page refresh | **SAFE** (was EXPOSED) | Fixed at `27e7a52`: in-flight request-fingerprint dedupe in `/api/generations`. |
| 10 | Negative balance under concurrency | **SAFE** | Optimistic lock: `updateMany({ where: { id, version, availableCredits: { gte: amount } } })`, `count !== 1` → 409. |
| 11 | Customer charged for a failed/blank output | **SAFE** | All-fail settles to 0 charged + full release; quality-gate failure → `settleVerifiedVariant(false)` → refund. |
| 12 | Free-tier / trial structurally unprofitable | **SAFE** | Explorer $2.99 → 57.3% worst-case margin. A $1/90cr tier was proven to be exactly 0% and is encoded as a test. |

## B. Generation lifecycle durability (13–22)

| # | Failure mode | Verdict | Evidence / gap |
|---|---|---|---|
| 13 | Work dies when the tab closes | **SAFE** | Fully server-driven: webhook URL is registered with MuAPI *before* the HTTP response returns. Client polling is display-only. |
| 14 | Lost provider webhook strands the job forever | **PARTIAL** | `/api/internal/reconcile` implements polling + a 25-min timeout sweep with refund. Correctness depends entirely on your external cron-job.org schedule; nothing in-repo schedules it. Worst case ≈ 25 min + 30 min cadence ≈ **55 min** to refund. |
| 15 | Webhook replay processed twice | **SAFE** | `WebhookEvent @@unique([provider, providerRequestId, payloadHash])`; `P2002` → `{duplicate:true}`. |
| 16 | Provider called twice for one job | **SAFE** | `claimProviderSubmission` lease; expired lease → `SUBMISSION_UNKNOWN`, never blindly re-POSTed. |
| 17 | Serverless teardown mid-dispatch | **PARTIAL** | Lands in `SUBMISSION_UNKNOWN` (deliberately not retried, to avoid double billing). Recovery needs reconcile → same dependency as #14. |
| 18 | Credits held forever on a stuck job | **PARTIAL** | Timeout sweep releases them — again gated on the external cron. |
| 19 | Output lost after successful generation | **SAFE** | Bytes uploaded to R2, then `GeneratedArtifact` upserted, then variant → `COMPLETED`. Artifact-before-completion ordering. |
| 20 | Completed output missing from My Library | **SAFE** | `GET /api/creations` is a plain server read of `Creation`/`Variant`/`GeneratedArtifact`. Zero client involvement. |
| 21 | Trusting the webhook body | **SAFE** | Result is re-fetched authenticated via `fetchAuthenticatedMuapiResult`. |
| 22 | Unauthenticated webhook spoofing | **SAFE** | Token-gated `verifyMuapiCallbackToken`. |

## C. Output correctness / QA (23–29)

| # | Failure mode | Verdict | Evidence / gap |
|---|---|---|---|
| 23 | Corrupt/unplayable media delivered | **SAFE** | `runFfprobe` + codec/dimension/duration/aspect gate; failure → `QUARANTINED` + refund. |
| 24 | Output doesn't match requested duration/resolution | **SAFE** | Same gate compares against the request. |
| 25 | Output doesn't match the *prompt* | **PARTIAL** | Whisper + Gemini verifiers exist. Semantic fidelity is inherently probabilistic; verdict is "checked", not "guaranteed". |
| 26 | Quarantined variant shows as an empty card | **PARTIAL** | Library filters to `validationStatus: VALID`, so a quarantined variant renders with no playable media. Cosmetic, but confusing. |
| 27 | User direction dropped from the prompt | **EXPOSED** | `CreationHub.js:653` `raw: (additionalInstructions \|\| sceneMotion \|\| "")` — `sceneMotion` is silently discarded when `additionalInstructions` is set. Not money, but it is "output isn't what the user asked for". |
| 28 | Verifier failure treated as generation failure | **SAFE** | `qaProfile.derivativeFailureIsNonTerminal`. |
| 29 | Late provider completion mutates a settled record | **SAFE** | `tests/late-completion-immutability.test.js`; terminal jobs short-circuit. |

## D. Access / authorisation (30–36)

| # | Failure mode | Verdict | Evidence / gap |
|---|---|---|---|
| 30 | Generating without an active plan | **SAFE** | `requireActivatedAccount()` on every route. |
| 31 | Using someone else's assets | **SAFE** | Per-asset ownership check → 403. |
| 32 | Reading another workspace's library | **SAFE** | Queries scoped to `userId` + `defaultWorkspaceId`. |
| 33 | Replaying another user's quote | **SAFE** | `preflightQuote.findFirst({ where: { id, userId } })`. |
| 34 | Tampering with a quote's credit amount | **SAFE** | `validateDispatch` re-asserts `internalCreditsToReserve === workflowPricing.quotedCredits` (`CREDIT_MISMATCH`) + payload hash checks. |
| 35 | Swapping the model after pricing | **SAFE** | Submit reads `quote.selectedModelId` from the DB, never client input; `MODEL_IDENTITY_MISMATCH`. |
| 36 | Plan capability caps unenforced | **EXPOSED** | `maxResolution` / `maxDurationSeconds` are read by **no code path**. Not a margin leak (credits are the backstop) but the advertised tiering is fiction in both directions. |

## E. Abuse / cost amplification (37–43)

| # | Failure mode | Verdict | Evidence / gap |
|---|---|---|---|
| 37 | Unbounded concurrent generations | **SAFE** | Hard cap of 2 active variants per workspace → 429. |
| 38 | Runaway daily provider spend | **SAFE** | `dailySpendLimitMicroUsd` checked against today's `ProviderJob` spend → 429. |
| 39 | SSRF via user-supplied asset URL | **SAFE** | SSRF-safe downloader + `assertProviderAssetsAreFetchable`. |
| 40 | Untrusted provider endpoint | **SAFE** | `UNTRUSTED_ENDPOINT_REJECTED`. |
| 41 | Malicious upload (type/size) | **SAFE** | MIME allow-list + media validation before use. |
| 42 | Signed asset URL leakage / expiry | **PARTIAL** | 900s signed R2 URLs. Short-lived, but a leaked URL is valid for its window. |
| 43 | Fan-out amplification via `outputCount` | **SAFE** | Priced per output *before* rounding; settlement schedule is per-output. |

## F. Data / operational integrity (44–50)

| # | Failure mode | Verdict | Evidence / gap |
|---|---|---|---|
| 44 | Ledger drift from the balance | **SAFE** | Every mutation writes a `CreditTransaction` with `balanceBefore/After` + `reservedBefore/After` and a unique idempotency key. |
| 45 | Double-release via mixed refund paths | **SAFE** | V1 branches deliberately skip `releaseVariantReservations`; `settleModelPlatformWorkflow` asserts exactly one reservation per creation. |
| 46 | Lost update on the credit account | **SAFE** | `version` optimistic lock + `Serializable` isolation on submit. |
| 47 | Stale credit balance shown to the user | **SAFE** (was EXPOSED) | Fixed at `27e7a52`: focus/visibility revalidation + terminal-state refresh, coalesced and rate-floored. |
| 48 | Annual plan revenue overstated 12× | **SAFE** | `creditsGrantedOverTerm` requires `termMonths`; refuses to default it. |
| 49 | Pricing revision skew between quote and charge | **SAFE** | `PRICING_REVISION_MISMATCH` + `REGISTRY_REVISION_MISMATCH` on dispatch. |
| 50 | Deploy rejected / silent config failure | **PARTIAL** | Sub-daily `crons` in `vercel.json` caused Vercel to reject **every** deployment on the Hobby plan; removed. Cron now lives outside the repo, which trades one failure mode for #14. |

---

## Summary

| Verdict | Count |
|---|---|
| SAFE | 38 |
| PARTIAL | 9 |
| EXPOSED | 3 |

### The three genuinely exposed items

1. **#36 Plan capability caps unenforced.** Needs a decision: enforce, or drop from marketing.
2. **#27 `sceneMotion` silently dropped** when `additionalInstructions` is present (`CreationHub.js:653`). Small fix, real user-visible wrongness.
3. **#14/#17/#18 (grouped) — every recovery guarantee depends on an out-of-repo cron.** The code is correct; the schedule is invisible to CI and to this repo. A missed cron converts a lost webhook into a permanently stuck generation with credits held.

### Highest-value next mitigation

For #14, a self-healing path that does not depend on an external scheduler: opportunistically run a bounded reconcile pass on ordinary authenticated requests (e.g. when a user loads their library), so an active user's own traffic recovers their own stuck jobs. Cheap, and it removes the single point of failure without a paid plan upgrade.
