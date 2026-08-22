import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/components/creation/CreationHub.js", import.meta.url), "utf8");

test("Video Studio defines and synchronizes the mobile viewport state used during render", () => {
  assert.match(source, /const \[isMobileViewport, setIsMobileViewport\] = useState\(false\)/);
  assert.match(source, /window\.matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(source, /style=\{\{ width: isMobileViewport \? "100%" : `\$\{sidebarWidth\}px` \}\}/);
});

test("Video Studio cleans up its viewport listener", () => {
  assert.match(source, /media\.addEventListener\("change", syncViewport\)/);
  assert.match(source, /media\.removeEventListener\("change", syncViewport\)/);
});


const videoFormSource = fs.readFileSync(new URL("../src/components/creation/VideoMakerForm.js", import.meta.url), "utf8");
const productFormSource = fs.readFileSync(new URL("../src/components/creation/ProductAdForm.js", import.meta.url), "utf8");
const appFormSource = fs.readFileSync(new URL("../src/components/creation/AppStudioForm.js", import.meta.url), "utf8");

test("Video Studio duration and output controls are projected from the selected model", () => {
  assert.match(videoFormSource, /selectedModel\?\.durationValues/);
  assert.match(videoFormSource, /selectedModel\?\.minDuration/);
  assert.match(videoFormSource, /selectedModel\?\.maxDuration/);
  assert.match(videoFormSource, /const aspectRatioValues = selectedModel\?\.aspectRatios/);
  assert.doesNotMatch(videoFormSource, /values=\{\["Auto", \.\.\.\(selectedModel\?\.aspectRatios/);
});


test("saved drafts never silently replace a retired model", () => {
  assert.match(source, /const resolvedModel = savedModelId \? getGenerationModel\(savedModelId\) : null/);
  assert.match(source, /const unavailableModelId = savedModelId && !compatibleModel \? savedModelId : null/);
  assert.match(source, /selectedModelId: draft\.unavailableModelId \|\| draft\.selectedModel\?\.id/);
  assert.doesNotMatch(source, /MODELS\.find\(\(model\) => model\.id === savedDraft\.selectedModelId\) \|\| fallback\.selectedModel/);
});

test("a retired draft model blocks generation until the user explicitly selects a replacement", () => {
  assert.match(source, /setUnavailableDraftModelId\(null\)/);
  assert.match(source, /const selectedModel = savedModelId \? compatibleModel : fallback\.selectedModel/);
  assert.match(source, /const modelSelectionRequired = Boolean\(isLoadingModels \|\| modelLoadError \|\| unavailableDraftModelId \|\| !selectedModelIsCompatible\)/);
  assert.match(source, /const pickerModels = unavailableDraftModelId \? \[\] : activeModels/);
  assert.match(source, /requiredInputReasons/);
  assert.match(source, /Use \{model\.name\}/);
  assert.match(source, /disabled=\{requiredInputsMissing \|\| isSubmitting \|\| quoteUnavailable \|\| slotsUnavailable \|\| hasInsufficientQuotedCredits\}/);
  assert.match(source, /Choose a replacement model/);
});


test("Video Studio applies the strictest model and plan output ceiling", () => {
  assert.match(source, /const generationOutputLimit = Math\.min\(videoSlots\.limit, modelOutputLimit\)/);
  assert.match(source, /maxVideos=\{generationOutputLimit\}/);
  assert.match(source, /setNumVideos\(generationOutputLimit\)/);
});

test("saved durations are validated against the restored model capabilities", () => {
  assert.match(source, /const isSupportedDraftDuration = \(model, value\) =>/);
  assert.match(source, /model\.durationValues\?\.length/);
  assert.match(source, /seconds >= model\.minDuration && seconds <= model\.maxDuration/);
  assert.doesNotMatch(source, /DURATION_OPTIONS/);
});


test("Product and App Studios derive duration choices from the selected model", () => {
  for (const formSource of [productFormSource, appFormSource]) {
    assert.match(formSource, /selectedModel\?\.durationValues/);
    assert.match(formSource, /selectedModel\?\.minDuration/);
    assert.match(formSource, /selectedModel\?\.maxDuration/);
    assert.match(formSource, /values=\{durationValues\}/);
    assert.doesNotMatch(formSource, /values=\{\["Auto", "5", "8", "12", "15"\]\}/);
  }
});


test("each Studio picker and blank draft use only workflow-compatible models", () => {
  assert.match(source, /const compatibleModelsForStudio = \(studioMode = "video_maker"\) =>/);
  assert.match(source, /const selectedModel = compatibleModelsForStudio\(studioMode\)\[0\] \|\| null/);
  assert.match(source, /video_maker: blankDraft\("video_maker"\)/);
  assert.match(source, /product: blankDraft\("product"\)/);
  assert.match(source, /app: blankDraft\("app"\)/);
  assert.match(source, /const activeModels = modelsByStudio\?\.\[activeModeId\] \|\| \[\]/);
  assert.match(source, /modelsList=\{pickerModels\}/);
  assert.match(source, /restoreDraft\(saved\.drafts\?\.product, "product"\)/);
  assert.match(source, /if \(studioMode === "app"\) return listAppStudioGenerationModels\(\)/);
  assert.match(appFormSource, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/quicktime"/);
});

test("draft hydration restores the actual initially selected Studio", () => {
  assert.match(source, /const initialDraft = useRef\(blankDraft\(STUDIO_IDS\[studioMode\] \? studioMode : "video_maker"\)\)\.current/);
  assert.match(source, /loadDraft\(restoredDrafts\[activeModeId\] \|\| blankDraft\(activeModeId\)\)/);
  assert.doesNotMatch(source, /loadDraft\(restoredDrafts\.video_maker\)/);
});

test("empty compatible-model state cannot build, preflight, or submit a request", () => {
  assert.match(source, /const selectedModel = compatibleModelsForStudio\(studioMode\)\[0\] \|\| null/);
  assert.match(source, /const selectedModelIsCompatible = Boolean\(selectedModel\?\.id/);
  assert.match(source, /if \(!selectedModelIsCompatible\) return null/);
  assert.match(source, /const canonicalRequestKey = canonicalRequest \? JSON\.stringify\(canonicalRequest\) : ""/);
  assert.match(source, /if \(requiredInputsMissing \|\| !canonicalRequestKey\)/);
  assert.match(source, /selectedModel\?\.outputCount\?\.max/);
  assert.match(source, /No compatible AI model is currently available/);
});

test("Product and App hide unsupported resolution and aspect controls", () => {
  for (const formSource of [productFormSource, appFormSource]) {
    assert.match(formSource, /const aspectRatioValues = selectedModel\?\.aspectRatios \|\| \[\]/);
    assert.match(formSource, /const resolutionValues = selectedModel\?\.resolutions \|\| \[\]/);
    assert.match(formSource, /\{resolutionValues\.length > 0 && \(/);
    assert.match(formSource, /\{aspectRatioValues\.length > 0 && \(/);
    assert.doesNotMatch(formSource, /selectedModel\?\.resolutions \|\| \["720p"\]/);
    assert.doesNotMatch(formSource, /selectedModel\?\.aspectRatios \|\| \["9:16"\]/);
  }
});

test("canonical settings omit unsupported or empty resolution and aspect ratio", () => {
  assert.match(source, /resolution && supportedResolutions\.includes\(resolution\) \? \{ resolution \} : \{\}/);
  assert.match(source, /aspectRatio && supportedAspectRatios\.includes\(aspectRatio\) \? \{ aspectRatio \} : \{\}/);
  assert.doesNotMatch(source, /^\s*resolution,\s*$/m);
  assert.doesNotMatch(source, /^\s*aspectRatio,\s*$/m);
});

test("upload handshake failures are explicit before asset access", () => {
  assert.match(source, /if \(!presign\.directUpload\) throw new Error/);
  assert.match(source, /if \(!data\?\.asset\) throw new Error/);
  assert.match(source, /Upload verification did not return an asset/);
});

test("App Studio allowlists screenshots and one screen recording with canonical roles", () => {
  assert.match(appFormSource, /accept=\{\["image\/", "video\/"\]\}/);
  assert.match(appFormSource, /video\/mp4,video\/quicktime/);
  assert.match(appFormSource, /startsWith\("video\/"\)/);
  assert.match(source, /APP_SCREEN_RECORDING/);
  assert.match(source, /const APP_MEDIA_MIME_TYPES = new Set/);
  assert.match(source, /restoredAppImages\.filter\(isSupportedAppAsset\)/);
  assert.match(source, /files\.some\(\(file\) => !isSupportedAppAsset\(file\)\)/);
  assert.match(source, /target === "app" && !isSupportedAppAsset\(storedAsset\)/);
  assert.match(source, /file\.type\.startsWith\("video\/"\) \? "APP_SCREEN_RECORDING" : "APP_PRIMARY_SCREEN"/);
  assert.match(source, /at most one screen recording/);
});

test("Generate exposes every required-field disabled reason", () => {
  assert.match(source, /Choose an avatar\./);
  assert.match(source, /!spokenScript\.trim\(\) && activeModeId !== "app"/);
  assert.match(source, /appRecordingNeedsScript/);
  assert.match(source, /Write a script for a recording-only app demo/);
  assert.match(source, /Upload at least one product image\./);
  assert.match(source, /Upload at least one app screenshot or screen recording\./);
  assert.match(source, /Confirm the analysis for every uploaded asset\./);
  assert.match(source, /disabled=\{requiredInputsMissing \|\| isSubmitting \|\| quoteUnavailable \|\| slotsUnavailable \|\| hasInsufficientQuotedCredits\}/);
});


test("all three video Studios load their authenticated server model catalogs independently", () => {
  assert.match(source, /Object\.entries\(MODEL_STUDIOS\)/);
  assert.match(source, /fetch\(`\/api\/models\?studio=\$\{encodeURIComponent\(studio\)\}`/);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/);
  assert.match(source, /setModelsByStudio\(\(current\) => \(\{ \.\.\.\(current \|\| \{\}\), \[modeId\]: data\.models \}\)\)/);
  assert.match(source, /setLoadingModelsByStudio\(\(current\) => \(\{ \.\.\.current, \[modeId\]: false \}\)\)/);
  assert.match(source, /if \(!Array\.isArray\(data\.models\)/);
  assert.match(source, /No enabled AI models are available/);
  assert.match(source, /Retry model loading/);
});

test("creation history failures are visible instead of masquerading as an empty shell", () => {
  assert.match(source, /readJsonResponse\(res, "Creation history"\)/);
  assert.match(source, /setCreationLoadError\(error\.message/);
  assert.match(source, /Creation history could not be loaded/);
  assert.match(source, /onClick=\{\(\) => void fetchCreations\(\)\}/);
});

test("every completed backend output becomes a playable or viewable card", () => {
  assert.match(source, /const creationCards = useMemo\(\(\) => creations\.flatMap/);
  assert.match(source, /Array\.isArray\(creation\.outputs\)/);
  assert.match(source, /url: output\.url/);
  assert.match(source, /creationCards\.map\(\(item\) =>/);
  assert.match(source, /Output \{item\.outputPosition\} of \{item\.deliveredOutputCount\}/);
  assert.match(source, /PARTIAL_COMPLETED/);
});

test("library assets are analyzed before confirmation when analysis is not complete", () => {
  assert.match(source, /if \(asset\.analysisStatus === "COMPLETED"\) \{/);
  assert.doesNotMatch(source, /asset\.analysisStatus === "COMPLETED" \|\| asset\.analysis/);
});
