import { chromium } from "playwright";
import path from "path";
import fs from "fs";

async function runFullQA() {
  console.log("[QA_AUTOMATION] Starting Real Browser QA on local preview server...");

  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Download the React DevTools")) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  const baseUrl = process.env.PREVIEW_URL || "http://localhost:3000";
  const targetUrl = `${baseUrl}/app/images`;

  console.log(`[QA_AUTOMATION] Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: "networkidle" });

  const artifactsDir = path.resolve("./artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  // 1. Gallery Assertions
  console.log("[QA_AUTOMATION] Testing Gallery Grid...");
  const exploreHeader = page.locator("h2:has-text('Explore Images')");
  const isExploreHeaderVisible = await exploreHeader.isVisible();
  console.log(`- Explore header visible: ${isExploreHeaderVisible}`);

  const oldWorkspaceHeader = page.locator("h2:has-text('Your workspace')");
  const isOldWorkspaceVisible = await oldWorkspaceHeader.isVisible();
  console.log(`- Former empty 'Your workspace' text gone: ${!isOldWorkspaceVisible}`);

  const thumbnails = page.locator("img[alt][src*='/explore/images/thumbs/']");
  const thumbCount = await thumbnails.count();
  console.log(`- Rendered curated thumbnails count: ${thumbCount} (expected: 29)`);

  // Verify thumbnails actually load
  let loadedCount = 0;
  for (let i = 0; i < Math.min(thumbCount, 5); i++) {
    const isLoaded = await thumbnails.nth(i).evaluate((img) => img.complete && img.naturalWidth > 0);
    if (isLoaded) loadedCount++;
  }
  console.log(`- Thumbnail image load check (sample 5): ${loadedCount}/5 loaded successfully`);

  // Capture desktop screenshot
  const desktopPath = path.join(artifactsDir, "desktop_explore_gallery.png");
  await page.screenshot({ path: desktopPath });
  console.log(`- Desktop screenshot captured: ${desktopPath}`);

  // 2. Reference-capable Model QA
  console.log("[QA_AUTOMATION] Testing Reference-capable model & reference selection...");
  
  // Select reference-capable model if select element exists
  const modelSelect = page.locator("select").first();
  if (await modelSelect.isVisible()) {
    await modelSelect.selectOption({ index: 1 });
  }

  // Click first Explore card "Use as reference"
  const card = page.locator(".group").first();
  await card.hover();
  const useRefBtn = page.locator("button:has-text('Use as reference'):not([disabled])").first();
  if (await useRefBtn.isVisible()) {
    await useRefBtn.click();
    console.log("- Clicked 'Use as reference'");
  }

  // Assert attached reference appears in composer strip with CURATED badge
  const curatedBadge = page.locator("span:has-text('CURATED')");
  const isCuratedBadgeVisible = await curatedBadge.isVisible();
  console.log(`- Attached reference visible in composer with CURATED badge: ${isCuratedBadgeVisible}`);

  // Test removal
  const removeBtn = page.locator("button[aria-label*='Remove']").first();
  if (await removeBtn.isVisible()) {
    await removeBtn.click();
    console.log("- Clicked removal button ('X')");
    const isRemoved = !(await curatedBadge.isVisible());
    console.log(`- Curated reference successfully removed: ${isRemoved}`);
  }

  // 3. My Assets Isolation QA
  console.log("[QA_AUTOMATION] Testing My Assets isolation...");
  const myAssetsBtn = page.locator("button:has-text('My Assets')");
  if (await myAssetsBtn.isVisible()) {
    await myAssetsBtn.click();
    console.log("- Opened My Assets drawer");
    const assetsDrawer = page.locator(".grid");
    const exploreInAssets = page.locator(".grid img[src*='/explore/images/']");
    const countInAssets = await exploreInAssets.count();
    console.log(`- Curated catalog images present in My Assets: ${countInAssets} (expected: 0)`);
    await myAssetsBtn.click(); // close
  }

  // 4. Model Switching QA
  console.log("[QA_AUTOMATION] Testing Model Switching & T2I compatibility...");
  // Re-attach an explore reference
  const cardSwitch = page.locator(".group").first();
  await cardSwitch.hover();
  const useRefSwitchBtn = page.locator("button:has-text('Use as reference')").first();
  if (await useRefSwitchBtn.isVisible()) await useRefSwitchBtn.click();

  // Open Model selector
  const modelBtn = page.locator("button:has-text('Model') + button").first();
  if (await modelBtn.isVisible()) {
    await modelBtn.click();
    // Select T2I model if available
    const t2iOption = page.locator("button:has-text('Text to image')").first();
    if (await t2iOption.isVisible()) {
      await t2iOption.click();
      console.log("- Switched to T2I model");
      const disabledMsg = page.locator("span:has-text('does not accept reference images')");
      console.log(`- Incompatible reference blocked/explained: ${await disabledMsg.isVisible()}`);
    }
  }

  // 5. Mobile Viewport QA (~390px)
  console.log("[QA_AUTOMATION] Testing Mobile ~390px Viewport...");
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${baseUrl}/app?tab=images`, { waitUntil: "domcontentloaded" });

  const mobileTabs = mobilePage.locator("button:has-text('Explore Images')");
  const isMobileTabVisible = await mobileTabs.isVisible();
  console.log(`- Mobile Explore tab visible: ${isMobileTabVisible}`);

  const mobileScreenshot = path.join(artifactsDir, "mobile_explore_gallery.png");
  await mobilePage.screenshot({ path: mobileScreenshot });
  console.log(`- Mobile screenshot captured: ${mobileScreenshot}`);

  await browser.close();

  console.log("\n=== REAL BROWSER QA EVIDENCE ===");
  console.log(`- Page Errors: ${pageErrors.length}`);
  console.log(`- Console Errors: ${consoleErrors.length}`);
  console.log(`- Failed Critical Requests: ${failedRequests.length}`);
  console.log("================================");
}

runFullQA().catch((err) => {
  console.error("[QA_AUTOMATION] Error:", err);
});
