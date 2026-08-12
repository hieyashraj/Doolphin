import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(navbar, /href="\/app"/);
  assert.match(navbar, /router\.push\("\/app\?tab=video&studio=video_maker"\)/);
  assert.match(app, /router\.push\(`\/app\?\$\{params\.toString\(\)\}`\)/);
  assert.match(gallery, /router\.replace\("\/app\?tab=library"\)/);
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
