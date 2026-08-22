import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppCompositionGeometry } from "../src/lib/app-studio/composition.js";

test("App preset composition modes resolve to materially different exact-media geometry", () => {
  const dimensions = [1080, 1920];
  const pip = resolveAppCompositionGeometry("PIP", ...dimensions);
  const sideBySide = resolveAppCompositionGeometry("SIDE_BY_SIDE", ...dimensions);
  const insert = resolveAppCompositionGeometry("INSERT", ...dimensions);
  const fullScreen = resolveAppCompositionGeometry("FULL_SCREEN", ...dimensions);

  assert.ok(pip.targetWidth < sideBySide.targetWidth);
  assert.equal(sideBySide.targetWidth, 540);
  assert.equal(sideBySide.targetHeight, 1920);
  assert.ok(insert.targetWidth < fullScreen.targetWidth);
  assert.deepEqual(fullScreen, { mode: "FULL_SCREEN", targetWidth: 1080, targetHeight: 1920, overlayX: 0, overlayY: 0 });
  assert.equal(new Set([pip.targetWidth, sideBySide.targetWidth, insert.targetWidth, fullScreen.targetWidth]).size, 4);
});

test("unknown composition values fail to the bounded insert layout", () => {
  assert.deepEqual(resolveAppCompositionGeometry("UNKNOWN", 1000, 500), resolveAppCompositionGeometry("INSERT", 1000, 500));
});
