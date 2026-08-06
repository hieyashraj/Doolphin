# AI UGC Video Preset Library

## Product implementation contract

This library contains 36 production-ready presets. A preset is not a finished prompt shown to the user. It is a hidden prompt template compiled at generation time from the user’s visible selections.

### Shared runtime placeholders

`[Avatar]`, `[Target Product]`, `[Product Type]`, `[Brand]`, `[Script]`, `[Duration]`, `[Aspect Ratio]`, `[Resolution]`, `[Platform]`, `[Primary Benefit]`, `[Pain Point]`, `[Supporting Features]`, `[CTA]`, `[Environment]`, `[Secondary Items]`, `[Reference Images]`, `[Reference Videos]`, `[Audio Reference]`, `[Voice]`, `[On-Screen Text]`, `[App Screens]`, `[Website URL]`, `[Offer]`.

### Compiler rules applied to every preset

1. Preserve the selected avatar’s identity, age, skin tone, facial structure, hair, and distinguishing features across every shot. All avatars shown as consumers, presenters, parents, experts, or employees must be adults unless the uploaded product context naturally includes a child; children must never deliver sales claims or be placed in unsafe situations.
2. Preserve the product’s exact shape, color, logo placement, label, packaging, screen layout, and proportions from the supplied references. Never invent ports, controls, ingredients, results, certifications, discounts, ratings, or features.
3. Use the exact approved script. Do not paraphrase, add claims, or improvise spoken lines. `[Duration]` must never exceed 15 seconds. If the script cannot fit naturally within the selected duration, flag it before generation and offer either a longer duration up to the 15-second maximum or AI shortening; never accelerate speech beyond a natural conversational pace.
4. Treat reference images and videos as composition, pacing, motion, lighting, or environment guidance unless the user explicitly designates a file as the product reference or avatar source. Do not copy a real person’s identity from a style reference.
5. If no voice or audio reference is supplied, generate a natural voice appropriate to the selected avatar and locale. Keep speech clean and foregrounded. Add only subtle room tone, product sounds, or royalty-safe music when the preset calls for it.
6. Recalculate shot boundaries for `[Duration]`, with a hard maximum of 15 seconds. Preserve the narrative order and reserve at least 1.5 seconds for the product payoff or CTA. For 5–7 seconds use 3 shots; 8–10 seconds use 3–4 shots; 11–15 seconds use 4–6 shots. If a preset contains more narrative beats, combine compatible beats rather than exceeding 15 seconds.
7. Compose natively for `[Aspect Ratio]`. For 9:16, protect the center 70% for captions and UI crops. For 1:1 and 4:5, tighten wide compositions. For 16:9, allow environmental context without making the product too small.
8. Generate at `[Resolution]` with physically plausible hands, reflections, shadows, contact, screen perspective, object weight, fabric behavior, and continuity. Use crisp edits and avoid morphing between shots.
9. On-screen text must be optional, correctly spelled, high contrast, inside safe margins, and limited to the user-approved wording. Never render placeholder text.
10. The final output must feel like a coherent piece filmed in one session unless the preset explicitly uses multiple locations or formats.

### Recommended visible fields

Show only: product/app input, preset, avatar, script or AI script, duration from 5–15 seconds, aspect ratio, resolution, number of outputs, references, voice/audio, language/accent, captions, CTA, and optional advanced controls. Enforce `duration_seconds <= 15` in both the interface and backend validation. Keep the compiled prompt, negative prompt, shot expansion logic, model routing, seed, and continuity controls hidden outside development/admin mode.

---

## 01. Mobile App — Screen-to-Life Demo

**Best for:** Consumer apps, productivity apps, finance tools, marketplaces, learning apps.  
**Default:** 15 seconds, 9:16, iPhone UGC, adult avatar, natural voice.  
**Required:** `[App Screens]`, `[Script]`, `[Avatar]`.  
**Optional:** phone model, room, CTA, screen recording, reference video.

```text
Camera: Authentic iPhone UGC. Mix of locked medium selfie framing, over-the-shoulder phone shots, macro taps, and one clean screen recording insert. Crisp jump cuts; no cinematic camera moves.
Lighting: Soft window daylight with realistic indoor exposure. Phone screen remains readable without glowing unnaturally.
Environment: Modern lived-in apartment or workspace selected from [Environment]. Neutral background, a few ordinary personal objects, no competing brand logos.
Continuity: Use the exact selected [Avatar]. Preserve the uploaded app UI precisely. The phone display must match [App Screens]; taps must land on the correct controls and trigger the correct next screen.

[Duration] Shot List
0%–16% | Hook: Medium shot. [Avatar] holds the phone near shoulder height, looks into lens, and begins [Script] with an immediate pain-point or outcome statement.
16%–34% | Problem: Hard cut to over-the-shoulder angle. [Avatar] demonstrates the old or frustrating task without inventing a competitor interface.
34%–58% | App Demo: Macro close-up of the phone. A finger opens [Brand/App], performs the primary action, and reaches the real result shown in the supplied screens.
58%–76% | Proof: Insert a clean screen recording or stabilized phone close-up showing the most persuasive real feature and [Primary Benefit].
76%–100% | Payoff: Return to the medium UGC shot. [Avatar] completes [Script], naturally presents the phone, and gives [CTA]. Hold the final app screen long enough to understand it.

Audio: Exact [Script], conversational and unscripted in feel. Natural pauses, subtle tap sounds, faint room tone. If [Audio Reference] exists, match its delivery energy and pacing without copying an unselected identity.
Avoid: Floating UI, unreadable screens, invented metrics, impossible taps, mirrored text, extra fingers, fake app-store badges, over-polished commercial lighting.
```

## 02. SaaS — Founder-Led Dashboard Walkthrough

**Best for:** B2B SaaS, analytics, CRM, AI tools, workflow software.  
**Default:** 15 seconds, 9:16 or 16:9, webcam/phone hybrid.  
**Required:** dashboard references, script, avatar.  
**Optional:** company role, metric, cursor recording, office reference.

```text
Camera: Founder-style UGC captured with a phone beside a laptop, alternating between a chest-up locked shot, over-the-shoulder laptop view, and crisp dashboard inserts. Slightly imperfect framing but clear professional credibility.
Lighting: Soft daylight from a side window, practical desk lamp visible, balanced screen exposure.
Environment: Realistic startup workspace with laptop, notebook, dark desk, plant, and restrained brand accents.
Performance: [Avatar] speaks like a knowledgeable builder explaining one useful workflow, not like a hired announcer. Never imply the avatar is the real founder unless the user has supplied and authorized their own clone.

[Duration] Shot List
0%–15% | Hook: [Avatar] faces camera beside the open laptop and delivers the first sentence of [Script].
15%–32% | Context: Fast over-the-shoulder view showing the actual starting state or pain point on the supplied dashboard.
32%–58% | Workflow: Two or three precise UI actions demonstrate the core feature. Cursor paths are deliberate; fields and labels remain faithful to references.
58%–76% | Outcome: Tight screen insert shows the resulting report, automation, status, or output supporting [Primary Benefit].
76%–100% | Close: Back to [Avatar]. They finish [Script], gesture once toward the screen, and deliver [CTA].

Audio: Exact [Script]. Calm, clear, peer-to-peer delivery. Low office ambience; no loud music.
Avoid: Fake revenue graphs, fabricated customer logos, random code, unreadable dashboards, excessive cursor motion, glossy corporate acting, unsupported guarantees.
```

## 03. Physical Product — Problem/Solution Transformation

**Best for:** Household products, tools, organizers, accessories, convenience products.  
**Default:** 15 seconds, 9:16.  
**Required:** product references, pain point, script, avatar.

```text
Camera: Raw iPhone UGC using a locked medium hook, close problem detail, handheld product application, and stable result shot. Fast, legible jump cuts.
Lighting: Natural daylight appropriate to [Environment], consistent before and after.
Environment: A believable location where [Pain Point] naturally occurs. Keep ordinary signs of use; do not make the problem grotesque or exaggerated.

[Duration] Shot List
0%–15% | Hook: [Avatar] faces camera holding [Target Product] and says the opening of [Script] while indicating the problem area.
15%–33% | Friction: Close-up clearly shows [Pain Point] in a realistic, non-staged way.
33%–58% | Use: [Avatar] applies or uses [Target Product] exactly as intended. Show correct grip, contact, scale, and sequence.
58%–78% | Reveal: Matched-angle result shot demonstrates [Primary Benefit] without changing unrelated objects, lighting, or environment.
78%–100% | Verdict: Medium shot. [Avatar] completes [Script], holds the product label toward camera, and gives [CTA].

Audio: Exact [Script], natural household ambience, clear product sounds where useful.
Avoid: Impossible instant results, unsafe use, invented accessories, exaggerated mess, changed product packaging, misleading before/after lighting, unsupported performance claims.
```

## 04. Unboxing — Genuine First Impression

**Best for:** E-commerce launches, subscription boxes, gadgets, beauty, gifts.  
**Default:** 15 seconds, 9:16.  
**Required:** packaged and unpackaged product references, script, avatar.

```text
Camera: Phone-camera UGC. Begin with a seated medium shot, move to top-down unboxing, alternate macro packaging details with a genuine reaction shot. Crisp cuts; one continuous unboxing chronology.
Lighting: Soft window daylight. Packaging colors and finish remain accurate.
Environment: Lived-in dining table, desk, or sofa area with minimal clutter.

[Duration] Shot List
0%–12% | Arrival: [Avatar] places the sealed package on the surface and delivers the hook from [Script].
12%–30% | Open: Top-down hands open the real packaging in a plausible way without tearing through branded areas unnecessarily.
30%–48% | First Look: Product is lifted out by the correct contact point. Macro shot shows material, texture, label, and included components.
48%–68% | Discovery: [Avatar] notices and demonstrates one real detail from [Supporting Features]. Expression is pleasantly surprised, not theatrical.
68%–84% | In-Hand Reaction: Medium close-up with product held at natural scale while [Avatar] continues [Script].
84%–100% | Hero: Product rests neatly beside packaging; [Avatar] finishes [Script] and [CTA].

Audio: Exact [Script], light cardboard/tissue/product sounds, optional low royalty-safe music.
Avoid: Invented inserts, duplicate products, fake seals, missing packaging pieces, aggressive reactions, floating hands, unreadable or altered labels.
```

## 05. How-To — Three-Step Tutorial

**Best for:** Products requiring education, setup, assembly, skincare application, tools.  
**Default:** 15 seconds, 9:16 or 1:1.  
**Required:** product references, correct usage steps, script.

```text
Camera: Clear instructional UGC mixing a medium introduction, overhead hands, side close-ups, and final result. Each action is fully visible before the cut.
Lighting: Bright soft daylight with minimal shadows over the working area.
Environment: Clean, relevant work surface in [Environment].

[Duration] Shot List
0%–13% | Promise: [Avatar] holds [Target Product] and begins [Script], stating what the viewer will learn.
13%–34% | Step 1: Overhead shot. Perform [Usage Step 1] correctly. Optional text: “1. [Approved Step Label]”.
34%–55% | Step 2: Closer side angle. Perform [Usage Step 2] with clear hand placement and realistic timing.
55%–75% | Step 3: Return overhead or macro. Perform [Usage Step 3] and visibly complete the process.
75%–90% | Result: Stable reveal of the valid finished state and [Primary Benefit].
90%–100% | Close: [Avatar] completes [Script] with [CTA].

Audio: Exact [Script]. Use subtle tactile sounds under speech. Captions may reinforce the three approved steps.
Avoid: Skipping safety steps, showing unapproved uses, speeding actions until unclear, ingredient or medical claims, mismatched result, ambiguous hand positions.
```

## 06. Comparison — Ordinary Option vs Product

**Best for:** Differentiated products with demonstrable advantages.  
**Default:** 15 seconds, 9:16 or 1:1.  
**Required:** target product, generic comparison object, comparison facts, script.

```text
Camera: iPhone UGC with matched side-by-side tabletop compositions, quick reaction inserts, and a clean product hero close. Use identical angles and conditions for a fair visual comparison.
Lighting: Bright, even natural light; never manipulate exposure to favor one side.
Environment: Simple home or workspace surface.

[Duration] Shot List
0%–14% | Hook: [Avatar] holds [Generic Alternative] in one hand and [Target Product] in the other while starting [Script].
14%–37% | Test A: Split-screen or consecutive matched shots demonstrate one user-supplied factual difference.
37%–60% | Test B: Repeat under the same conditions for [Primary Benefit].
60%–78% | Practical Impact: Show how that difference affects an ordinary real-life task.
78%–100% | Choice: [Avatar] sets aside the generic alternative, presents [Target Product], and completes [Script] plus [CTA].

Audio: Exact [Script], concise and confident. Natural object sounds.
Avoid: Competitor logos without permission, rigged tests, invented specifications, disparaging claims, unequal conditions, fake damage, or claims like “best” without substantiation.
```

## 07. Listicle — Three Reasons I Keep Using It

**Best for:** Broad-benefit products, retargeting, feature education.  
**Default:** 15 seconds, 9:16.  
**Required:** three verified benefits, product, script, avatar.

```text
Camera: Energetic but believable phone UGC. Locked talking-head hook followed by three distinct micro-scenes and a final handheld product close-up.
Lighting: Natural daylight adjusted to each real environment while maintaining consistent skin and product color.
Environment: Use up to three contextually relevant spaces, or one space with clearly distinct angles.

[Duration] Shot List
0%–12% | Hook: [Avatar] holds [Target Product] and begins [Script]. Optional approved title: “3 reasons I keep using this”.
12%–34% | Reason 1: Demonstrate [Benefit 1] in action; optional small numeral “1”.
34%–56% | Reason 2: New angle and action demonstrate [Benefit 2].
56%–78% | Reason 3: Third micro-scene demonstrates [Benefit 3].
78%–100% | Summary: Product close-up followed by [Avatar] completing [Script] and [CTA].

Audio: Exact [Script]. Natural pacing with a brief beat between reasons. Low upbeat royalty-safe bed only if enabled.
Avoid: Repeating the same visual three times, listing unverifiable claims, overly fast speech, intrusive graphics, or a product that changes between scenes.
```

## 08. Personal Story — “I Didn’t Expect This”

**Best for:** Testimonial-style ads, discovery stories, lifestyle products.  
**Default:** 15 seconds, 9:16.  
**Required:** truthful story framing, script, avatar, product.

```text
Camera: Intimate phone UGC with a locked chest-up opening, two memory-style B-roll inserts, an authentic product-use clip, and a quiet final recommendation. Slight handheld imperfection is welcome.
Lighting: Soft side-window daylight; warm but not heavily graded.
Environment: Comfortable lived-in space connected to the use case.
Performance: [Avatar] speaks thoughtfully, with small pauses and restrained gestures. If the avatar is fictional, present the story as an ad performance and never imply a verified real customer identity.

[Duration] Shot List
0%–18% | Curiosity Hook: [Avatar] begins [Script] with the surprising observation.
18%–38% | Before Context: B-roll illustrates the situation or routine before using [Target Product], without an exaggerated failure.
38%–62% | Discovery: Show the product entering the routine and the exact key action.
62%–82% | Why It Stayed: Close product-use detail supports [Primary Benefit] and [Supporting Feature].
82%–100% | Honest Close: Return to [Avatar] for the final line and [CTA], ending on a natural half-smile rather than a sales pose.

Audio: Exact [Script], intimate room tone, no dramatic swells.
Avoid: False customer claims, fake timelines, guaranteed outcomes, theatrical crying, invented reviews, or excessive beauty filtering.
```

## 09. Daily Routine — Product Naturally Embedded

**Best for:** Habit products, accessories, wellness tools, home and personal-care items.  
**Default:** 15 seconds, 9:16.  
**Required:** routine stage, product, script, avatar.

```text
Camera: Day-in-the-life UGC mixing a mirror or countertop medium shot, hands-on close-ups, moving follow shot, and final grab-and-go frame.
Lighting: Time-of-day appropriate natural light, consistent with the selected routine.
Environment: Realistic bedroom, bathroom, kitchen, entryway, or workspace based on [Environment].

[Duration] Shot List
0%–12% | Routine Hook: [Avatar] starts the routine and opens [Script] while naturally reaching for [Target Product].
12%–34% | Setup: Show the surrounding items and the product’s place in the routine.
34%–58% | Use: Close-up demonstrates the key action and [Primary Benefit].
58%–78% | Continue: [Avatar] proceeds with the day, showing the product reducing friction rather than stopping to advertise it.
78%–100% | Takeaway: Medium shot or doorway close. [Avatar] finishes [Script], briefly presents product, and gives [CTA].

Audio: Exact [Script] as direct-to-camera or natural voiceover. Preserve relevant room sounds.
Avoid: Implausibly spotless sets, unrelated montage, unsafe personal-care use, rushed actions, fake outcome claims, or continuity errors in clothing and props.
```

## 10. Travel Packing — What Fits Inside

**Best for:** Bags, organizers, luggage, outdoor equipment.  
**Default:** 15 seconds, 9:16.  
**Required:** product, capacity-safe item list, script, avatar.

```text
Camera: UGC iPhone. Mix of fixed locked-off medium framing, top-down packing POV, trunk or doorway reveal, and steady destination B-roll. Crisp jump cuts.
Lighting: Soft window daylight indoors; bright natural light at the destination.
Environment: [Indoor Environment], [Transit Environment], and [Destination Environment] selected by the user or inferred conservatively from references.

[Duration] Shot List
0%–14% | Hook: [Avatar] faces camera holding [Target Product] by its intended handle or support point and begins [Script].
14%–34% | Packing POV: Top-down view into the open product. Hands place [Secondary Items] into their correct pockets or compartments.
34%–54% | Capacity Proof: Place [Secondary Container] or largest approved item into the central area at realistic scale.
54%–72% | Finish: Tuck remaining items into valid spaces and close or secure the product correctly.
72%–86% | Transit Reveal: Product sits securely in a vehicle trunk, entryway, or luggage area. [Avatar] retrieves it naturally.
86%–100% | Destination: Wide or medium B-roll shows [Avatar] carrying [Target Product] in the intended environment while finishing [Script] or [CTA].

Audio: Exact [Script] across direct speech and voiceover. Subtle zipper, fabric, and ambient location sounds.
Avoid: Impossible capacity, objects clipping through dividers, product placed inside itself, changing logos, unsafe vehicle behavior, fake weather protection, or destination discontinuity.
```

## 11. Desk Setup — Gadget Productivity Upgrade

**Best for:** Electronics, desk accessories, chargers, keyboards, creator tools.  
**Default:** 15 seconds, 9:16 or 16:9.  
**Required:** product references, compatible devices, script.

```text
Camera: Crisp phone B-roll combined with a short talking-head hook. Use overhead desk geometry, macro connection shots, and a clean working-state reveal.
Lighting: Soft daylight plus practical monitor glow; preserve accurate indicator colors.
Environment: Real working desk with laptop, notebook, cable management, plant, and no unrelated logos.

[Duration] Shot List
0%–13% | Hook: [Avatar] at desk identifies [Pain Point] using the opening of [Script].
13%–32% | Before: Overhead view shows the clutter, limitation, or repetitive task without caricature.
32%–56% | Setup: Hands connect, mount, position, or activate [Target Product] using only verified ports and controls.
56%–77% | In Use: Macro and over-the-shoulder shots show the real function and [Primary Benefit].
77%–100% | Finished Desk: Stable wide reveal; [Avatar] completes [Script] and [CTA].

Audio: Exact [Script], subtle clicks and keyboard sounds, restrained music if enabled.
Avoid: Impossible device compatibility, random ports, floating cables, fake screen content, overdone RGB, electrical hazards, or unexplained product duplication.
```

## 12. Kitchen — Recipe or Food-Prep Integration

**Best for:** Kitchen tools, appliances, food storage, cookware, ingredients.  
**Default:** 15 seconds, 9:16.  
**Required:** product, safe steps, ingredients/items, script.

```text
Camera: Bright home-kitchen UGC using a medium presenter shot, overhead prep, macro texture/action, and plated or organized result. Fast but readable cuts.
Lighting: Clean window daylight with natural food color; no heavy saturation.
Environment: Modern but lived-in kitchen with clear work surface.

[Duration] Shot List
0%–12% | Hook: [Avatar] introduces [Pain Point] or desired result while holding [Target Product] and begins [Script].
12%–30% | Ingredients/Setup: Overhead layout shows only user-approved ingredients or items.
30%–58% | Action: Demonstrate correct product use with safe hand placement and plausible cooking or prep behavior.
58%–77% | Key Detail: Macro shot highlights [Primary Benefit], texture, storage seal, cut, blend, or other verified outcome.
77%–91% | Result: Clean overhead or three-quarter reveal of the completed food/prep state.
91%–100% | Close: [Avatar] finishes [Script] and [CTA].

Audio: Exact [Script], satisfying natural kitchen sounds under narration.
Avoid: Unsafe blades or heat handling, raw/cooked continuity mistakes, invented ingredients, impossible timing, false nutrition claims, altered product geometry, or messy unreadable labels.
```

## 13. Home Organization — Satisfying Reset

**Best for:** Storage, cleaning accessories, organizers, space-saving products.  
**Default:** 15 seconds, 9:16 or 1:1.  
**Required:** product, approved items, target space, script.

```text
Camera: Phone UGC with a quick presenter hook, locked before frame, top-down sorting, tactile close-ups, and a matched after frame. Clean jump cuts with satisfying visual order.
Lighting: Bright natural daylight; identical exposure and angle for before and after.
Environment: Real drawer, shelf, wardrobe, bathroom, pantry, or desk selected through [Environment].

[Duration] Shot List
0%–12% | Hook: [Avatar] points to the cluttered but believable space, holds [Target Product], and begins [Script].
12%–27% | Before: Stable wide or overhead view clearly establishes [Pain Point].
27%–58% | Reset: Hands sort [Secondary Items] into the product. Show real compartments, closures, or mounting behavior.
58%–75% | Detail: Close-up demonstrates access, labeling, stacking, or space use supporting [Primary Benefit].
75%–90% | Matched Reveal: Repeat the original angle with the organized result; do not change the amount of space or secretly remove items.
90%–100% | Close: [Avatar] completes [Script] and [CTA].

Audio: Exact [Script], subtle fabric, drawer, click, or placement sounds.
Avoid: Impossible storage capacity, disappearing objects, altered room dimensions, fake dirt, unsafe chemical use, or mismatched before/after angles.
```

## 14. Cleaning Product — Real-Time Demonstration

**Best for:** Brushes, cloths, small cleaning tools, surface-care products.  
**Default:** 15 seconds, 9:16.  
**Required:** product, approved surface/use, script.

```text
Camera: Direct iPhone demonstration with a medium hook, macro surface detail, continuous cleaning pass, and matched reveal. Prioritize proof over presenter screen time.
Lighting: Flat natural window light that reveals texture honestly.
Environment: Relevant kitchen, bathroom, car interior, or living space.

[Duration] Shot List
0%–12% | Hook: [Avatar] shows [Target Product] and the ordinary mess while opening [Script].
12%–30% | Evidence: Tight shot defines the exact surface condition without exaggerating it.
30%–62% | Demonstration: In one visible sequence, [Avatar] uses the product according to supplied directions. Keep contact and pressure physically plausible.
62%–82% | Result: Matched close-up shows the cleaned area beside an untouched reference area when appropriate.
82%–100% | Verdict: [Avatar] holds the unchanged product packaging toward camera and completes [Script] plus [CTA].

Audio: Exact [Script], authentic brush/wipe/spray sounds, no loud soundtrack.
Avoid: Hazardous chemical mixing, unapproved surfaces, impossible one-pass removal, fake sparkling effects, changed lighting, or medical/sanitation claims not provided.
```

## 15. Parent Perspective — Calm Bedtime or Care Routine

**Best for:** Baby-safe comfort products, nursery products, family organizers, sound machines.  
**Default:** 15 seconds, 9:16.  
**Required:** product, adult caregiver avatar, safety-approved use, script.

```text
Camera: Gentle phone UGC from an adult caregiver’s perspective. Mix a quiet medium introduction, close product setup, wide nursery context, and final peaceful product hero. Any child present is secondary, clothed, age-appropriate, supervised, and never used to deliver claims.
Lighting: Soft natural daylight or warm low evening practical light with visible detail; never place loose lighting or equipment near a sleeping area.
Environment: Calm, realistic nursery or family living space with safe product placement.

[Duration] Shot List
0%–16% | Caregiver Hook: Adult [Avatar] speaks softly to camera while holding [Target Product] and begins [Script].
16%–36% | Setup: Close-up shows adult hands activating or positioning the product exactly as directed.
36%–58% | Feature: Macro shot demonstrates one verified light, sound, motion, texture, or organizational feature.
58%–80% | Routine Context: Wide shot shows the product fitting naturally into the care routine with the caregiver remaining present.
80%–100% | Close: Adult [Avatar] finishes [Script] and [CTA]; end on a clear product shot in a safe location.

Audio: Exact [Script], quiet room tone, only approved product audio. Keep narration intelligible and soothing.
Avoid: Unsafe sleep positioning, products placed in a crib unless explicitly certified and shown correctly, child testimonials, medical promises, unsupported “guaranteed sleep” claims, or overstimulating edits.
```

## 16. Pet Product — Owner-and-Pet Demonstration

**Best for:** Pet toys, grooming tools, feeders, travel accessories.  
**Default:** 15 seconds, 9:16.  
**Required:** product, intended animal, safe use, script, adult avatar.

```text
Camera: Playful but controlled phone UGC. Use an adult owner hook, low pet-eye-level B-roll, close product interaction, and a calm result shot. Animal behavior must remain natural and cannot be forced.
Lighting: Bright indoor daylight or safe outdoor shade.
Environment: Pet-friendly living room, yard, or walking area without hazards.

[Duration] Shot List
0%–13% | Hook: Adult [Avatar] holds [Target Product] while the pet is nearby and begins [Script].
13%–31% | Introduction: Let the pet notice or approach the product naturally.
31%–58% | Use: Show correct owner setup and pet interaction from two complementary angles.
58%–78% | Benefit: Close-up demonstrates the verified convenience, enrichment, grooming, travel, or feeding benefit.
78%–100% | Close: Owner and pet share frame; [Avatar] completes [Script] and [CTA], followed by a clean product close-up.

Audio: Exact [Script], natural pet and room sounds, optional light music.
Avoid: Distressed animals, forced reactions, unsafe restraints, unsuitable food, unsupported health claims, impossible pet behavior, or product scale changes.
```

## 17. Fashion Product — Fit, Detail, and Styling

**Best for:** Adult clothing, shoes, bags, watches, jewelry, accessories.  
**Default:** 15 seconds, 9:16.  
**Required:** product references, adult avatar, styling notes, script.

```text
Camera: Natural phone fashion UGC using a mirror-style hook, full or three-quarter styling view, macro material details, movement B-roll, and final look. The avatar remains an adult and the presentation focuses on the product, comfort, construction, and styling—not body critique.
Lighting: Soft window daylight with accurate fabric and skin color.
Environment: Tidy bedroom, hallway mirror, dressing area, or outdoor street selected through [Environment].

[Duration] Shot List
0%–14% | Hook: Adult [Avatar] holds or wears [Target Product], looks into lens, and begins [Script].
14%–34% | Full Look: Stable frame shows the product’s real silhouette and proportion.
34%–55% | Detail: Macro shots show texture, stitching, closure, hardware, sole, or finish exactly as referenced.
55%–75% | Styling/Movement: [Avatar] adds one approved complementary item or walks/turns naturally to show movement.
75%–100% | Verdict: Medium close-up and product detail while [Avatar] finishes [Script] and [CTA].

Audio: Exact [Script], natural room or street ambience, low music if enabled.
Avoid: Changing body shape, sexualized framing, minors, impossible fabric physics, altered patterns/logos, misleading fit, unsupported durability claims, or extra jewelry/accessories that compete with the product.
```

## 18. Beauty Product — Texture and Routine Demo

**Best for:** Cosmetics and non-medical skincare used by adults.  
**Default:** 15 seconds, 9:16.  
**Required:** product, adult avatar, approved directions, script.

```text
Camera: Close, credible phone UGC with a direct-to-camera hook, clean product macro, texture swatch on an appropriate area, correct application, and natural-finish reveal.
Lighting: Soft neutral daylight. Keep skin texture visible and do not use smoothing, reshaping, or complexion-changing filters.
Environment: Bright bathroom vanity or bedroom mirror with minimal clutter.

[Duration] Shot List
0%–13% | Hook: Adult [Avatar] holds [Target Product] near the face without obscuring identity and begins [Script].
13%–30% | Product Detail: Macro packaging, applicator, and real texture.
30%–58% | Application: Demonstrate only the approved quantity, area, and method with clean hands/tools.
58%–78% | Finish: Honest close-up under the same light shows cosmetic finish or feel, not an invented biological transformation.
78%–100% | Takeaway: [Avatar] completes [Script] and [CTA] with product label readable.

Audio: Exact [Script], soft handling sounds, no exaggerated sparkle effects.
Avoid: Medical or permanent-result claims, skin whitening, body dissatisfaction messaging, pore-erasing filters, unsafe application, altered shade, fake dermatologist endorsement, or misleading before/after changes.
```

## 19. ASMR — Tactile Product Close-Up

**Best for:** Packaging, stationery, accessories, textured goods, satisfying mechanisms.  
**Default:** 12 seconds, 9:16 or 1:1.  
**Required:** product reference and approved actions. Script optional.

```text
Camera: Intimate macro phone video with stable top-down and 45-degree close-ups. Slow deliberate hands, shallow but sufficient focus, clean match cuts. Product remains the sole hero.
Lighting: Large soft window source revealing texture and edges without harsh reflections.
Environment: Quiet tabletop with a neutral tactile surface suited to [Brand].

[Duration] Shot List
0%–17% | Reveal: Hands slide [Target Product] into frame and pause on the brand-facing angle.
17%–38% | Open/Touch: Activate the main closure, lid, paper, zipper, switch, or texture with accurate mechanics.
38%–61% | Detail: Macro shot captures [Supporting Feature] and its characteristic sound.
61%–82% | Use: Perform one short intended action at natural speed.
82%–100% | Hero: Place product neatly in final position; optional whispered final line or [CTA] from [Script].

Audio: Prioritize clean real product sounds. If [Script] exists, keep it minimal and intimate. No music by default.
Avoid: Artificially loud foley, wet sounds unrelated to product, floating tools, impossible mechanisms, identity-focused framing, damaged labels, or excessive slow motion.
```

## 20. Luxury Product — Understated Editorial UGC

**Best for:** Premium accessories, fragrance packaging, leather goods, design objects.  
**Default:** 15 seconds, 9:16 or 4:5.  
**Required:** product references, brand mood, script or text.

```text
Camera: Premium phone-camera realism rather than studio advertising. Use controlled handheld push-ins, macro craftsmanship, reflective side angle, adult avatar interaction, and a restrained hero frame.
Lighting: Directional window daylight with soft falloff and accurate specular highlights.
Environment: Minimal dark wood, stone, linen, or modern interior consistent with [Brand].

[Duration] Shot List
0%–16% | Intrigue: Partial product silhouette enters frame as [Avatar] begins [Script] or the first approved text appears.
16%–38% | Craft: Macro details show material, stitching, glass, metal, engraving, or finish exactly as supplied.
38%–62% | Ritual: Adult [Avatar] handles or uses the product slowly and correctly.
62%–82% | Lifestyle: Medium environmental shot connects the product to its intended setting without ostentation.
82%–100% | Signature: Clean hero frame and final [Script]/[CTA], with a short hold.

Audio: Exact [Script] with calm delivery, subtle room tone, minimal royalty-safe music if enabled.
Avoid: Fake gold sparkle, invented engravings, excessive wealth symbolism, copied luxury-brand trade dress, distorted reflections, beauty reshaping, or loud sales delivery.
```

## 21. Outdoor Adventure — Built for the Elements

**Best for:** Bags, outerwear, bottles, portable gear, outdoor accessories.  
**Default:** 15 seconds, 9:16 or 16:9.  
**Required:** product, environment, verified performance facts, script, adult avatar.

```text
Camera: UGC phone footage blending a locked indoor gear hook, top-down preparation, vehicle or trailhead transition, and stable wide outdoor B-roll. Cuts are crisp; movement remains safe and believable.
Lighting: Soft daylight indoors; bright natural outdoor light appropriate to actual weather references.
Environment: Gear room or living area, safe transit location, and [Outdoor Environment].

[Duration] Shot List
0%–14% | Hook: Adult [Avatar] presents [Target Product] and begins [Script].
14%–35% | Prepare: Overhead hands load, wear, attach, or fill the product using approved [Secondary Items].
35%–55% | Feature Proof: Close-up demonstrates a real closure, material, insulation, grip, pocket, or weather-related feature without simulating an unsupported certification.
55%–74% | Transition: Product is secured in a trunk or carried at a trailhead; vehicle remains stationary.
74%–100% | Environment: Wide and medium B-roll shows safe use in [Outdoor Environment] while [Avatar] completes [Script] or voiceover and [CTA].

Audio: Exact [Script], natural wind/footstep/gear sounds kept beneath voice.
Avoid: Dangerous terrain behavior, moving-vehicle shots, fake storms, impossible waterproofing, unsupported survival claims, changing weather between adjacent shots, or product/logo drift.
```

## 22. Car Talk — Candid Recommendation

**Best for:** Services, apps, subscriptions, compact products, story-based ads.  
**Default:** 15 seconds, 9:16.  
**Required:** script, adult avatar, product/app visual.

```text
Camera: Stationary front-facing phone mounted safely inside a parked car. One candid chest-up take broken by two relevant B-roll inserts and a final product/app close-up. Natural iPhone processing and mild exposure shifts.
Lighting: Daylight through windshield and side windows; face evenly readable.
Environment: Parked modern car in a safe, ordinary location. Engine state is not emphasized; no driving occurs.

[Duration] Shot List
0%–22% | Candid Hook: Adult [Avatar] looks into the mounted phone and begins [Script] as if sharing a useful discovery.
22%–42% | Context: Quick insert shows the real situation, product, or app screen being discussed.
42%–68% | Explanation: Back to [Avatar] for the core benefit, using natural hand gestures below eye level.
68%–84% | Proof: Close-up of [Target Product] or approved app outcome.
84%–100% | Recommendation: [Avatar] finishes [Script] and [CTA], ending naturally rather than holding a commercial pose.

Audio: Exact [Script], subtle car cabin ambience, no music by default.
Avoid: Driving while filming, seatbelt misuse, fake dashboard warnings, phone use behind the wheel, exaggerated testimonial claims, or an overly polished studio look.
```

## 23. Street Interview — One-Question Social Proof

**Best for:** Brand awareness, simple value propositions, event or location campaigns.  
**Default:** 15 seconds, 9:16.  
**Required:** approved question/answers, adult avatars, product or app.

```text
Camera: Handheld vertical phone interview with a visible or off-camera interviewer, two or three adult respondents, quick environmental cutaways, and a product payoff. Natural reframing and clean jump cuts.
Lighting: Bright open shade or flat daylight; consistent with the real location.
Environment: Safe pedestrian plaza, campus-like public area restricted to adults, shopping district, or event space. Avoid identifiable uninvolved bystanders.
Performance: Responses are short ad performances based only on [Script]; do not present fictional avatars as verified customers or random members of the public.

[Duration] Shot List
0%–12% | Question Hook: On-screen approved question or interviewer asks the first line.
12%–34% | Response 1: Adult avatar gives the first concise answer.
34%–56% | Response 2: Different adult avatar and angle gives a contrasting benefit.
56%–73% | Response 3/Proof: Third response or direct product/app demonstration.
73%–88% | Product Payoff: Tight shot connects answers to [Target Product] and [Primary Benefit].
88%–100% | CTA: Presenter or approved text completes [CTA].

Audio: Exact approved dialogue. Clear lav-like speech with low natural street ambience.
Avoid: Minors, harassment, hidden-camera framing, fake claims of spontaneity, copied identities, noisy crowds, unapproved logos, or invented consensus statistics.
```

## 24. Podcast Clip — Conversational Authority

**Best for:** SaaS, education, services, considered purchases, founder messaging.  
**Default:** 15 seconds, 9:16 or 1:1.  
**Required:** script, adult avatar, topic/product.

```text
Camera: Vertical podcast-style clip captured with one locked three-quarter close-up, one complementary side angle, and relevant product/screen B-roll. Professional enough to hear clearly but not a glossy broadcast.
Lighting: Soft window or diffused key light with natural background depth.
Environment: Small modern recording nook with microphone, headphones optionally resting nearby, plant, and warm practical light.
Performance: Adult [Avatar] speaks as an informed host or user. Do not imply regulated professional credentials, real podcast ownership, or real customer experience unless supplied and authorized.

[Duration] Shot List
0%–20% | Strong Claim/Question: [Avatar] begins [Script] in close-up; optional approved headline appears.
20%–45% | Explanation: Side angle continues the thought with one natural gesture.
45%–68% | Evidence B-Roll: Show [Target Product], dashboard, app screen, or workflow supporting the statement.
68%–86% | Takeaway: Return to close-up for the clearest benefit.
86%–100% | Close: [Avatar] completes [Script] and [CTA]; hold for a natural beat.

Audio: Exact [Script], clean close-mic sound, low room tone, no artificial audience reaction.
Avoid: Fake credentials, invented study citations, counterfeit podcast branding, huge subtitles covering the face, aggressive motivational delivery, or unsupported guarantees.
```

## 25. Green-Screen Commentary — React and Explain

**Best for:** Apps, websites, product pages, feature announcements, educational ads.  
**Default:** 15 seconds, 9:16.  
**Required:** background image/video, script, adult avatar.

```text
Camera: Native social green-screen format. Adult [Avatar] appears chest-up in the lower foreground while the supplied [Reference Image/Video] fills the background. Add two punch-in edits and one full-screen reference insert.
Lighting: Even phone-camera light on the avatar, naturally separated from the background without a glowing cutout edge.
Environment: Digital background is exactly the user-supplied page, app, product image, chart, or media reference.

[Duration] Shot List
0%–18% | Hook: [Avatar] points toward the most relevant background area and begins [Script].
18%–42% | Explain: Background crops to the approved feature or detail while the avatar continues speaking.
42%–62% | Full-Screen Proof: Reference fills frame; a simple pointer or highlight indicates the exact item being discussed.
62%–82% | Takeaway: Avatar returns in foreground with a tighter crop and states [Primary Benefit].
82%–100% | CTA: Background shows the approved final screen or product; [Avatar] completes [Script] and [CTA].

Audio: Exact [Script], clean social-video voice, no music by default.
Avoid: Hallucinated webpages, pointing at the wrong item, illegible background text, green fringing, copied creator identity, misleading news framing, or presenting unverified content as fact.
```

## 26. Screen Recording + Facecam — Live Use Case

**Best for:** Apps, websites, browser extensions, SaaS, online services.  
**Default:** 15 seconds, 9:16 or 16:9.  
**Required:** approved screen flow, script, adult avatar.

```text
Camera: Realistic screen-recording composition with a small circular or rounded facecam of adult [Avatar], alternating with full-screen UI and one physical phone/laptop shot. Cursor and taps precisely follow the supplied workflow.
Lighting: Facecam uses soft natural desk light; screen content stays crisp and color accurate.
Environment: Screen is primary. Physical insert uses a simple home office.

[Duration] Shot List
0%–16% | Hook: Facecam appears over the starting screen as [Avatar] begins [Script].
16%–38% | Input: Cursor or finger performs the real first action and enters only approved example content.
38%–60% | Process: Show the minimum essential steps, skipping wait time with a clear jump cut rather than a false instant result.
60%–78% | Output: Full-screen result demonstrates [Primary Benefit] with readable UI.
78%–90% | Real-World Insert: Over-the-shoulder shot connects the digital result to actual use.
90%–100% | CTA: Return to screen plus facecam for final [Script] and [CTA].

Audio: Exact [Script], subtle click/tap sounds, light room tone.
Avoid: Fake UI, password or private data exposure, invented integrations, impossible processing claims, random cursor movement, unreadable fields, or facecam covering key controls.
```

## 27. Myth vs Fact — Fast Educational Correction

**Best for:** Product education, objection handling, misunderstood categories.  
**Default:** 15 seconds, 9:16.  
**Required:** verified myth, verified fact, product connection, script.

```text
Camera: Confident direct-to-camera UGC with two distinct compositions: slightly wider “Myth” setup and brighter close “Fact” setup, followed by a practical demonstration. Use approved text labels only.
Lighting: Consistent natural light; visual distinction comes from framing and background position, not deceptive exposure.
Environment: Relevant home, office, or product-use setting.

[Duration] Shot List
0%–15% | Pattern Interrupt: Adult [Avatar] begins [Script] with the misconception. Optional text: “MYTH”.
15%–34% | Clarify: Quick cut; [Avatar] states the approved fact. Optional text: “FACT”.
34%–62% | Demonstrate: Hands or screen show the exact evidence or mechanism related to [Target Product].
62%–82% | Practical Meaning: Show how the correction changes the user’s decision or routine.
82%–100% | Close: [Avatar] completes [Script] and [CTA].

Audio: Exact [Script], concise and friendly, no alarmist sound effects.
Avoid: Medical/legal/financial advice without proper review, fake studies, overgeneralized facts, insulting viewers, invented test results, or unsupported product superiority.
```

## 28. FAQ — Rapid Objection Answers

**Best for:** Retargeting, high-consideration products, pricing or setup objections.  
**Default:** 15 seconds, 9:16.  
**Required:** two or three approved questions and answers, script, product.

```text
Camera: Friendly phone UGC with a locked presenter shot, question cards, answer-specific product B-roll, and a clean final CTA. Each answer receives a visually different angle.
Lighting: Soft daylight, approachable and unfiltered.
Environment: Relevant everyday space with product accessible.

[Duration] Shot List
0%–10% | Setup: Adult [Avatar] holds [Target Product] and introduces the rapid FAQ using [Script].
10%–32% | Question 1: Approved question appears; [Avatar] answers while showing the relevant feature.
32%–54% | Question 2: New angle and demonstration support the second answer.
54%–76% | Question 3: Optional third objection receives a concise factual answer and close-up proof.
76%–90% | Summary: Product hero plus the single strongest approved takeaway.
90%–100% | CTA: [Avatar] finishes [Script] and [CTA].

Audio: Exact [Script], natural pacing, subtle transition sounds only.
Avoid: Tiny text, invented return policies, hidden conditions, false reassurance, unsupported guarantees, repetitive visuals, or answers too fast to understand.
```

## 29. Offer Announcement — Clear, Honest Promotion

**Best for:** Sales, bundles, launches, free trials, seasonal campaigns.  
**Default:** 12 seconds, 9:16 or 4:5.  
**Required:** verified offer terms, product, dates if relevant, script.

```text
Camera: Energetic phone UGC combining a direct hook, fast product-use proof, bundle or offer layout, and final CTA. Use clean text overlays derived only from [Offer].
Lighting: Bright natural light with accurate product color.
Environment: Simple home or work setting appropriate to the product.

[Duration] Shot List
0%–17% | Offer Hook: Adult [Avatar] presents [Target Product] and opens [Script] with the exact offer.
17%–42% | Why It Matters: Quick action shot demonstrates [Primary Benefit].
42%–65% | What’s Included: Overhead or screen view clearly displays the approved bundle, price, trial, or bonus.
65%–83% | Terms: Show essential approved condition or date legibly without rushing.
83%–100% | CTA: [Avatar] completes [Script] and [CTA]; final frame holds product and offer text.

Audio: Exact [Script], upbeat but credible. Music optional.
Avoid: Fake countdowns, false scarcity, hidden fees, invented discounts, flashing pressure tactics, unreadable terms, duplicated bundle items, or expired dates.
```

## 30. Stop-Motion Tabletop — Product Feature Sequence

**Best for:** Small products, kits, stationery, accessories, packaging, bundles.  
**Default:** 12 seconds, 9:16, 1:1, or 4:5.  
**Required:** product and included components, optional script.

```text
Camera: Locked overhead phone composition. Use deliberate stop-motion placement, geometric arrangement, short live-action hand insert, and final hero layout. Camera and surface never shift between frames.
Lighting: Even diffuse daylight with stable shadows and white balance.
Environment: Clean tabletop using one brand-compatible surface and limited props.

[Duration] Shot List
0%–18% | Arrival: [Target Product] enters frame through stop-motion and settles label-up.
18%–42% | Components: Approved included items appear one at a time around the product in a balanced layout.
42%–62% | Feature: A live-action hand opens, connects, folds, or demonstrates one real mechanism.
62%–82% | Recompose: Stop-motion organizes components into the intended use or bundle arrangement.
82%–100% | Hero: Final layout holds with approved [On-Screen Text] or short [Script]/[CTA].

Audio: Rhythmic natural clicks and placement sounds; optional exact short voiceover. Royalty-safe music only.
Avoid: Invented accessories, teleportation during live action, camera drift, inconsistent shadows, duplicate objects, unreadable labels, or childish animation when brand mood is premium.
```

## 31. Split-Screen — Reaction + Demonstration

**Best for:** Satisfying products, app outcomes, tools, compact explainers.  
**Default:** 15 seconds, 9:16.  
**Required:** demonstration media or instructions, avatar, script.

```text
Camera: Vertical split-screen. Upper or left panel features adult [Avatar] reacting and explaining; lower or right panel shows a synchronized product demonstration. Transition to full-screen proof and final presenter close.
Lighting: Natural and consistent within each panel. No fake studio reaction setup.
Environment: Presenter in a simple home space; demo in the true use environment.

[Duration] Shot List
0%–18% | Hook: Split-screen opens. [Avatar] begins [Script] while the demonstration establishes [Pain Point].
18%–48% | Synchronized Use: Product action advances as the presenter explains the corresponding feature.
48%–68% | Key Moment: Demo expands full screen for the strongest verifiable visual payoff.
68%–84% | Reaction: Presenter returns full screen with a restrained, authentic response.
84%–100% | Close: Product and presenter share composition while [Avatar] completes [Script] and [CTA].

Audio: Exact [Script], demo sounds kept low beneath voice.
Avoid: Stolen reaction-video styling, exaggerated shock, mismatched timing, looping demo, fake results, tiny split panels, or a presenter looking at the wrong screen area.
```

## 32. Founder Story — Why We Built This

**Best for:** New brands, SaaS, mission-led products, crowdfunding-style launches.  
**Default:** 15 seconds, 9:16 or 16:9.  
**Required:** approved brand story, product, script, authorized founder clone or adult presenter.

```text
Camera: Honest founder-style phone film using a direct desk or workshop introduction, problem B-roll, design/process details, product-in-use proof, and a quiet final statement. If [Avatar] is not the real authorized founder, present them as a brand spokesperson and do not claim personal authorship.
Lighting: Natural window light across real-looking workspaces; no dramatic commercial backlight.
Environment: Office, workshop, home studio, or environment supported by brand references.

[Duration] Shot List
0%–16% | Origin Hook: [Avatar] begins the exact [Script] with the problem that motivated the product.
16%–34% | Problem Context: Relevant B-roll shows the real friction or unmet need.
34%–56% | Building Detail: Show sketches, materials, interface, testing, or packaging only when provided or approved.
56%–76% | Product Proof: Demonstrate [Target Product] solving the intended problem.
76%–90% | Mission: Return to [Avatar] for the approved brand belief or difference.
90%–100% | Invitation: Complete [Script] and [CTA], ending on product plus brand.

Audio: Exact [Script], thoughtful pacing, restrained music optional.
Avoid: Fabricated founding events, fake prototypes, false claims of invention, invented team members, unsupported impact numbers, theatrical struggle, or implying a spokesperson is the founder.
```

## 33. Local Service — From Problem to Booked

**Best for:** Cleaning, repair, tutoring, design, professional and home services.  
**Default:** 15 seconds, 9:16 or 4:5.  
**Required:** service facts, location coverage, booking flow, script, adult avatar.

```text
Camera: Local-business UGC with a customer-perspective hook, short service process, visible outcome, and clear booking screen. Use a spokesperson or staged customer performance without implying an unverified real testimonial.
Lighting: Bright natural light at the real type of service location.
Environment: Home, office, storefront, or worksite appropriate to [Service], with no unauthorized addresses or personal information visible.

[Duration] Shot List
0%–15% | Need: Adult [Avatar] states [Pain Point] and begins [Script].
15%–34% | Booking: Phone close-up shows the exact approved booking or contact flow.
34%–59% | Service: Two concise B-roll shots show safe, professional work without fabricating licenses or specialist procedures.
59%–78% | Outcome: Honest result or completed deliverable supports [Primary Benefit].
78%–90% | Local Relevance: Approved service area, response window, or business identifier appears.
90%–100% | CTA: [Avatar] completes [Script] and [CTA].

Audio: Exact [Script], natural location sounds, optional subtle music.
Avoid: Fake uniforms or credentials, unverified reviews, guaranteed timing, false local addresses, private data, unsafe work, misleading before/after footage, or invented service areas.
```

## 34. Gift Reaction — Thoughtful Reveal

**Best for:** Gifts, personalized items, keepsakes, seasonal products.  
**Default:** 15 seconds, 9:16.  
**Required:** product, adult avatars if two people appear, script, occasion.

```text
Camera: Warm phone UGC with a giver introduction, over-the-shoulder handoff, close unwrapping, restrained adult reaction, and product detail. Keep emotion natural and secondary to the product.
Lighting: Soft daylight or warm indoor practical light with accurate product detail.
Environment: Comfortable living or dining space suited to [Occasion].

[Duration] Shot List
0%–14% | Setup: Adult [Avatar/Giver] quietly shows [Target Product] or wrapped package and begins [Script].
14%–34% | Handoff: Second adult receives the gift in a natural medium shot.
34%–55% | Reveal: Close hands unwrap and expose the exact product and any approved personalization.
55%–73% | Reaction: Receiver responds with a genuine smile and inspects the relevant detail.
73%–88% | Product Meaning: Macro shot supports [Primary Benefit] or personalized feature.
88%–100% | Close: Giver or voiceover completes [Script] and [CTA].

Audio: Exact [Script], soft paper/box sounds, low room tone.
Avoid: Minors as sales performers, exaggerated crying, invented names or personalization, romantic roleplay, damaged packaging, fake scarcity, duplicate products, or obscured branding.
```

## 35. Image-Led Showcase — Animate Product Photography

**Best for:** Sellers with strong product images but limited video footage.  
**Default:** 15 seconds, 9:16, 4:5, or 1:1.  
**Required:** three or more product images, script or approved text. Avatar optional.

```text
Camera: Transform supplied [Reference Images] into restrained, physically plausible video moments. Use gentle parallax, controlled rack focus, one detail push-in, one contextual composite only if supported by references, and an optional adult avatar bookend. Preserve the source product exactly.
Lighting: Inherit direction, softness, reflections, and color temperature from each source image. Do not relight the product inconsistently.
Environment: Use the photographed environment or a user-approved compatible setting.

[Duration] Shot List
0%–16% | Hero Motion: First image receives subtle depth and camera movement while the opening [Script] or approved text appears.
16%–38% | Angle Change: Cut to second source angle with realistic parallax and no product morph.
38%–60% | Feature Detail: Controlled push-in highlights [Supporting Feature] from a source that visibly contains it.
60%–80% | Context: Third image or approved lifestyle composition communicates [Primary Benefit].
80%–100% | Final Hero: Strongest source returns with optional [Avatar] voiceover, [CTA], and a clean hold.

Audio: Exact [Script] as voiceover, subtle royalty-safe music and restrained transitions.
Avoid: Invented unseen sides, moving printed labels independently, warped logos, impossible rotations, excessive 3D orbit, fake hands, or new product features absent from references.
```

## 36. Reference-Led Recreation — Match the Creative Grammar

**Best for:** Users supplying a reference ad whose pacing, framing, or structure they want to emulate.  
**Default:** 15 seconds or the shorter reference duration; never exceed 15 seconds. Native requested aspect ratio.  
**Required:** reference video, target product, script, avatar where relevant.

```text
Reference Analysis: First extract only the reference video’s creative grammar: hook type, shot count, shot durations, camera placement, framing, transition rhythm, lighting style, environment categories, performance energy, caption behavior, and audio structure. Do not copy protected characters, logos, music, exact dialogue, distinctive choreography, a real person’s identity, or unique branded set design.
Camera: Rebuild the analyzed grammar using [Target Product], selected [Avatar], [Brand], [Script], and user-provided environments. Preserve product and avatar continuity throughout.
Lighting: Match the reference’s broad lighting qualities—soft/hard, warm/cool, indoor/outdoor, high/low contrast—while keeping the target product accurate.
Environment: Translate the reference locations into functionally similar but original settings compatible with [Brand].

[Duration] Shot List
0%–15% | Original Hook: Create a new hook serving the same narrative function as the reference, using the opening of [Script].
15%–40% | Setup: Reproduce the reference’s pacing and shot-category pattern with original compositions and target-product actions.
40%–70% | Demonstration: Show the real product feature or app flow required by [Script]; do not force an incompatible reference action.
70%–88% | Payoff: Deliver [Primary Benefit] using an original shot that matches the reference’s energy.
88%–100% | Close: Use the selected [CTA] and brand-safe final frame.

Audio: Use exact [Script]. Match only pace, energy, pause pattern, and broad music mood. Use the selected [Voice]/[Audio Reference] or generate a new suitable voice; never clone a reference speaker without authorization.
Avoid: Shot-for-shot copying of distinctive creative, copyrighted music, copied dialogue, identity imitation, competitor branding, incompatible product actions, reference text leakage, or output that ignores the user’s product facts.
```

---

## Preset routing and generation logic

At generation time, compile the selected preset in this order:

`Global compiler rules → selected preset prompt → product facts → avatar identity packet → exact script → reference analysis → audio instructions → render settings → model-specific syntax → negative constraints.`

### Reference precedence

When inputs conflict, use this order: explicit user instructions first; verified product/app reference second; selected avatar identity third; exact script fourth; preset creative structure fifth; style reference last. Ask for resolution instead of guessing when two explicit user inputs conflict.

### Script-duration guardrail

The maximum selectable and generated duration is 15 seconds. Estimate natural delivery at roughly 2.1–2.7 spoken English words per second, adjusted for language, voice, punctuation, and delivery. For a 15-second UGC video, treat approximately 28–35 English words as the normal target, 36–40 words as potentially rushed, and more than 40 words as unlikely to fit naturally; confirm with the selected voice’s timing whenever possible. Reserve approximately 10–20% of runtime for pauses and product-only moments. Before charging credits, display one of three states: **Fits naturally**, **May feel rushed**, or **Will not fit**. Offer “shorten with AI” or “increase duration” only when the selected duration is below 15 seconds. At 15 seconds, offer shortening only; never silently rewrite an exact user script.

### Multi-video behavior

When the user requests multiple videos, keep product facts and identity fixed while varying only controlled creative dimensions: hook framing, first shot, B-roll order, environment angle, delivery energy, caption style, or CTA framing. Do not return near-duplicate outputs and do not randomly change the avatar, product, claims, or brand assets.

### Recommended development-mode diagnostics

In development/admin mode, show the compiled prompt, resolved placeholders, reference precedence decisions, calculated speech length, selected model and why, expected credit cost, seed/continuity identifier, and any unsupported-field warnings. In production, hide those internals and show only a concise generation summary.
