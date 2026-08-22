import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { INITIAL_VIDEO_MODELS, normaliseVideoModels } from "../src/lib/studio/clientModelRegistry.js";

test("shared studio workspace has a browser-safe real MuAPI fallback model", () => {
  assert.equal(INITIAL_VIDEO_MODELS.length, 1);
  assert.equal(INITIAL_VIDEO_MODELS[0].id, "muapi.seedance2.omni-reference-fast");
  assert.deepEqual(INITIAL_VIDEO_MODELS[0].resolutions, ["720p"]);
});

test("full catalog responses are normalised before the Video Studio renders them", () => {
  const models = normaliseVideoModels([{ id: "muapi.example", name: "Example", description: "A model" }]);
  assert.deepEqual(models[0].resolutions, ["720p"]);
  assert.deepEqual(models[0].aspectRatios, ["9:16", "16:9"]);
  assert.equal(models[0].minDuration, 4);
  assert.equal(models[0].maxDuration, 10);
});

test("CreationHub does not bundle the server provider catalog into its initial client render", () => {
  const source = fs.readFileSync(new URL("../src/components/creation/CreationHub.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /lib\/generation\/modelRegistry/);
  assert.match(source, /clientModelRegistry/);
  assert.match(source, /\/api\/models\?studio=video-studio/);
});
