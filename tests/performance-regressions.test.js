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
