import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("logout clears the browser session before redirecting and does not refresh protected SSR", async () => {
  const navbar = await text("src/components/Navbar.js");
  assert.match(navbar, /setSigningOut\(true\)/);
  assert.match(navbar, /await createClient\(\)\.auth\.signOut\(\)/);
  assert.match(navbar, /setAccount\(null\)/);
  assert.match(navbar, /router\.replace\("\/sign-in"\)/);
  assert.doesNotMatch(navbar, /router\.refresh\(\)/);
});

test("the protected app bootstraps one authoritative account state instead of duplicate client requests", async () => {
  const [layout, navbar, app, hub] = await Promise.all([
    text("src/app/(app)/layout.js"), text("src/components/Navbar.js"), text("src/app/(app)/app/page.js"), text("src/components/creation/CreationHub.js")
  ]);
  assert.match(layout, /safeAccountState/);
  assert.match(layout, /initialAccount/);
  assert.match(navbar, /useAppAccount/);
  assert.match(app, /useAppAccount/);
  assert.doesNotMatch(navbar, /fetch\("\/api\/account"/);
  assert.doesNotMatch(app, /fetch\("\/api\/account"/);
  assert.doesNotMatch(hub, /fetch\("\/api\/account\/balance"/);
});

test("only active generations poll and card media is viewport-gated", async () => {
  const [hub, lazyVideo, app] = await Promise.all([
    text("src/components/creation/CreationHub.js"), text("src/components/LazyVideo.js"), text("src/app/(app)/app/page.js")
  ]);
  assert.match(hub, /hasActiveGeneration/);
  assert.match(hub, /\[creations\]/);
  assert.match(lazyVideo, /IntersectionObserver/);
  assert.match(lazyVideo, /preload="metadata"/);
  assert.match(app, /<LazyVideo/);
  assert.match(app, /loading="lazy" decoding="async"/);
});

test("creation list uses a workspace-scoped narrow projection and batches retry metadata", async () => {
  const route = await text("src/app/api/creations/route.js");
  assert.match(route, /workspaceId: appUser\.defaultWorkspaceId/);
  assert.match(route, /select:/);
  assert.match(route, /retryQuoteIds/);
  assert.match(route, /preflightQuote\.findMany/);
  assert.doesNotMatch(route, /retryQuote \? await prisma\.preflightQuote\.findUnique/);
});

test("the app defers the library collection request until the Library view is opened", async () => {
  const app = await text("src/app/(app)/app/page.js");
  assert.match(app, /if \(currentTab !== "library"\) return/);
  assert.match(app, /hasLoadedLibraryCreations/);
});

test("generated media and uploaded inputs keep distinct customer-facing libraries", async () => {
  const [app, navigation, picker, video, product, studio] = await Promise.all([
    text("src/app/(app)/app/page.js"),
    text("src/lib/app/app-navigation.js"),
    text("src/components/creation/AssetLibraryPicker.js"),
    text("src/components/creation/VideoMakerForm.js"),
    text("src/components/creation/ProductAdForm.js"),
    text("src/components/creation/AppStudioForm.js"),
  ]);
  assert.match(app, />My Library</);
  assert.match(navigation, /name: "My Library"/);
  assert.match(picker, /Choose from My Assets/);
  assert.match(picker, /fetch\("\/api\/assets"\)/);
  for (const form of [video, product, studio]) assert.match(form, /label="My Assets"/);
});

test("uploads fail explicitly when R2 direct upload is unavailable", async () => {
  const [route, hub] = await Promise.all([
    text("src/app/api/uploads/presign/route.js"),
    text("src/components/creation/CreationHub.js"),
  ]);
  assert.match(route, /Asset uploads are temporarily unavailable/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /directUpload: false/);
  assert.doesNotMatch(hub, /fetch\("\/api\/upload"/);
});

test("generation requires a server preflight quote and presents its credits before submission", async () => {
  const [hub, review] = await Promise.all([
    text("src/components/creation/CreationHub.js"), text("src/components/creation/PreflightReview.js"),
  ]);
  assert.match(hub, /setPreparedQuote\(data\)/);
  assert.match(hub, /Generate Video · \$\{quotedCredits\} credits/);
  assert.match(hub, /await submitGeneration\(preparedQuote\.quote, crypto\.randomUUID\(\)\)/);
  assert.match(hub, /GENERATION_CONFIGURATION_UNPRICED/);
  // The generate button must stay disabled while an unavailable saved model
  // requires explicit replacement, while submitting, while the request cannot
  // be priced, and while the plan/model concurrency ceiling is unavailable.
  assert.match(hub, /disabled=\{requiredInputsMissing \|\| isSubmitting \|\| quoteUnavailable \|\| slotsUnavailable \|\| hasInsufficientQuotedCredits\}/);
  assert.match(review, /insufficientCredits/);
  assert.match(review, /No provider request or credit reservation has happened yet/);
  assert.match(review, /disabled=\{isSubmitting \|\| insufficientCredits\}/);
});

test("My Library routes only sign validated artifacts in the active workspace", async () => {
  const [detail, preview, download, collection] = await Promise.all([
    text("src/app/api/creations/[id]/route.js"),
    text("src/app/api/creations/[id]/preview/route.js"),
    text("src/app/api/creations/[id]/download/route.js"),
    text("src/app/api/creations/route.js"),
  ]);
  for (const route of [detail, preview, download]) {
    assert.match(route, /workspaceId: appUser\.defaultWorkspaceId/);
  }
  for (const route of [detail, preview, download]) {
    assert.match(route, /FINAL_VIDEO/);
    assert.match(route, /FINAL_IMAGE/);
    assert.match(route, /validationStatus: "VALID"/);
  }
  assert.match(collection, /id: body\.id, userId: appUser\.id, workspaceId: appUser\.defaultWorkspaceId/);
});

test("Prisma application runtime routes exclusively through DATABASE_URL with max pool size 1", async () => {
  const prismaJs = await text("src/lib/prisma.js");
  assert.match(prismaJs, /const databaseUrl = process\.env\.DATABASE_URL/);
  assert.match(prismaJs, /connectionString: databaseUrl/);
  assert.match(prismaJs, /max: 1/);
  assert.doesNotMatch(prismaJs, /process\.env\.DIRECT_URL \|\| databaseUrl/);
  assert.doesNotMatch(prismaJs, /connectionString: process\.env\.DIRECT_URL/);
});

test("perf module only emits logs outside production (VERCEL_ENV guard)", async () => {
  const perf = await text("src/lib/perf.js");
  // Must gate on VERCEL_ENV !== "production" so logs are silent in Production
  assert.match(perf, /VERCEL_ENV.*!==.*"production"/);
  // Must export the three public helpers
  assert.match(perf, /export function newReqId/);
  assert.match(perf, /export function logPerf/);
  assert.match(perf, /export async function timed/);
  // logPerf must not emit when isPerfLoggingEnabled() is false
  assert.match(perf, /if \(!isPerfLoggingEnabled\(\)\) return/);
});

test("perf timing is instrumented on the full sign-in → /app bootstrap path", async () => {
  const [sync, auth, layout] = await Promise.all([
    text("src/app/api/auth/sync/route.js"),
    text("src/lib/access/authorization.js"),
    text("src/app/(app)/layout.js"),
  ]);

  // /api/auth/sync instruments getUser, linkSupabaseIdentity, and total
  assert.match(sync, /newReqId/);
  assert.match(sync, /sync:supabase\.auth\.getUser/);
  assert.match(sync, /sync:linkSupabaseIdentity/);
  assert.match(sync, /sync:total/);

  // authorization.js instruments getUser, user DB lookup, single-pass workspace+entitlement+creditAccount lookup
  assert.match(auth, /auth:supabase\.auth\.getUser/);
  assert.match(auth, /auth:user\.findUnique/);
  assert.match(auth, /auth:workspace\+entitlement\+creditAccount/);

  // AppLayout instruments requireActivatedAccount and total
  assert.match(layout, /newReqId/);
  assert.match(layout, /layout:requireActivatedAccount/);
  assert.match(layout, /layout:total/);
});


test("client-side sign-in executes direct Supabase authentication and sets ephemeral welcome notice", async () => {
  const signInPage = await text("src/app/(auth)/sign-in/page.js");

  // Client executes signInWithPassword directly
  assert.match(signInPage, /signInWithPassword/);

  // Sets ephemeral welcome-back notice in sessionStorage
  assert.match(signInPage, /sessionStorage\.setItem\("doolphin-auth-notice", "welcome-back"\)/);

  // Hard document navigation to /app
  assert.match(signInPage, /window\.location\.replace\("\/app"\)/);
});


test("post-auth boundary uses deterministic window.location.replace('/app') without calling /api/auth/sync", async () => {
  const [signInPage, healthRoute, nextAuthRoute, perf] = await Promise.all([
    text("src/app/(auth)/sign-in/page.js"),
    text("src/app/api/health/route.js"),
    text("src/app/api/auth/[...nextauth]/route.js"),
    text("src/lib/perf.js"),
  ]);

  // Successful returning sign-in navigates directly to /app without calling /api/auth/sync
  assert.match(signInPage, /window\.location\.replace\("\/app"\)/);
  assert.doesNotMatch(signInPage, /fetch\("\/api\/auth\/sync"/);

  // Wrong password shows explicit credential rejection error
  assert.match(signInPage, /setError\("Email or password is incorrect\."\)/);

  // Error catch block handles timeout and resets submitting state
  assert.match(signInPage, /CLIENT_AUTH_TIMEOUT/);
  assert.match(signInPage, /setSubmitting\(false\)/);

  // App-level recovery state handled for ?denied=1
  assert.match(signInPage, /You're signed in, but we're having trouble loading your workspace/);

  // Deployable runtime no longer depends on obsolete NextAuth
  assert.doesNotMatch(healthRoute, /getServerSession/);
  assert.match(nextAuthRoute, /410/);

  // Production logging guard remains active
  assert.match(perf, /process\.env\.VERCEL_ENV !== "production"/);
});

