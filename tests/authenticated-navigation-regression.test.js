import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getActiveAppDestination } from "../src/lib/app/app-navigation.js";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("authenticated shell navigation never routes studio controls to the public home", async () => {
  const [navbar, app, gallery] = await Promise.all([
    text("src/components/Navbar.js"),
    text("src/app/(app)/app/page.js"),
    text("src/app/gallery/page.js")
  ]);

  for (const source of [navbar, app, gallery]) {
    assert.doesNotMatch(source, /["'`]\/\?tab=/);
    assert.doesNotMatch(source, /href="\/"/);
  }
  assert.match(navbar, /navigateAppView/);
  assert.match(app, /navigateAppView/);
  assert.doesNotMatch(navbar, /router\.push\("\/app\?tab=/);
  assert.doesNotMatch(app, /router\.push\(`\/app\?/);
  assert.match(gallery, /router\.replace\("\/app\?tab=library"\)/);
});

test("tab and studio changes keep the protected shell mounted while updating shareable history", async () => {
  const navigation = await text("src/lib/app/app-navigation.js");
  assert.match(navigation, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(navigation, /url\.pathname = "\/app"/);
  assert.match(navigation, /url\.searchParams\.set\("tab", tab\)/);
  assert.match(navigation, /PopStateEvent\("popstate"\)/);
});

test("featured studio cards retain the authenticated shell and select the existing studio state", async () => {
  const [app, hub] = await Promise.all([
    text("src/app/(app)/app/page.js"),
    text("src/components/creation/CreationHub.js")
  ]);

  assert.match(app, /studio: "video_maker"/);
  assert.match(app, /studio: "product"/);
  assert.match(app, /studio: "app"/);
  assert.match(app, /studioMode=\{currentStudio\}/);
  assert.match(hub, /onStudioModeChange\?\.\(nextModeId\)/);
  assert.match(hub, /STUDIO_IDS\[studioMode\]/);
});

test("authenticated navigation resolves exactly one active destination per route/tab/studio state", () => {
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "explore" }), "explore");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "video", studio: "video_maker" }), "video");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "video", studio: "product" }), "product");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "video", studio: "app" }), "app_studio");
  assert.equal(getActiveAppDestination({ pathname: "/app/images" }), "images");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "avatars" }), "avatars");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "assets" }), "assets");
  assert.equal(getActiveAppDestination({ pathname: "/app", tab: "library" }), "library");
  assert.equal(getActiveAppDestination({ pathname: "/app/images/library" }), "library");
});

test("authenticated navigation has one active destination and preserves canonical routes", async () => {
  const [navigation, navbar, legacy, signIn] = await Promise.all([
    text("src/lib/app/app-navigation.js"),
    text("src/components/Navbar.js"),
    text("src/app/(app)/app/images/library/page.js"),
    text("src/app/(auth)/sign-in/page.js")
  ]);
  for (const name of ["Explore", "Video Studio", "Product Studio", "App Studio", "Image Studio", "Avatars", "My Assets", "My Library"]) {
    assert.match(navigation, new RegExp(`name: "${name}"`));
  }
  assert.match(navigation, /getActiveAppDestination/);
  assert.match(navigation, /normalizedPathname === "\/app\/images"/);
  assert.match(navbar, /APP_NAV_DESTINATIONS\.map/);
  assert.match(legacy, /redirect\("\/app\?tab=library"\)/);
  assert.match(signIn, /NEXT_PUBLIC_SUPABASE_GOOGLE_OAUTH_ENABLED/);
});
