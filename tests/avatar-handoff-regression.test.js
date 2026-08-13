import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlatformAvatar } from "../src/lib/generation/avatarRegistry.js";
import { getAppDestinationHref, navigateAppView } from "../src/lib/app/app-navigation.js";

test("avatar registry validates server-authoritative avatars correctly", () => {
  const andrew = resolvePlatformAvatar("andrew");
  assert.notEqual(andrew, null);
  assert.equal(andrew.name, "Andrew");
  assert.equal(andrew.url, "/avatars/Andrew E1.png");

  const choi = resolvePlatformAvatar("CHOI");
  assert.notEqual(choi, null);
  assert.equal(choi.name, "Choi");

  const invalid = resolvePlatformAvatar("invalid_hacker_avatar_99");
  assert.equal(invalid, null);
});

test("avatar handoff generates safe URL with avatarId search parameter", () => {
  let routedHref = null;
  const mockRouter = {
    push(href) { routedHref = href; },
    replace(href) { routedHref = href; }
  };

  navigateAppView({ tab: "video", studio: "video_maker", avatarId: "andrew", router: mockRouter });
  assert.equal(routedHref, "/app?tab=video&studio=video_maker&avatarId=andrew");
});
