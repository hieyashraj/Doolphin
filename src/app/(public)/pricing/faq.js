/**
 * PRICING FAQ CONTENT.
 *
 * Every answer here is a statement about behaviour that is actually implemented,
 * and several point at specific enforced rules (the three-step access gate, the
 * per-plan concurrency ceiling, monthly grant scheduling on annual terms). Kept
 * out of the page component so the copy can be reviewed as copy.
 *
 * Detailed licensing, refund and acceptable-use questions deliberately link to
 * /terms, /privacy and /refund-policy rather than being paraphrased here — a
 * pricing FAQ must not become a second, subtly different set of terms.
 *
 * NOTHING here may describe a tier difference that is not enforced in code. The
 * only enforced differences are credits per month, how many videos generate at
 * once (assertVideoSlotAvailable), and Seedance 2.5 being excluded from the
 * Explorer trial (assertModelAllowedForPlan).
 */
export const FAQ_GROUPS = [
  {
    label: "Getting started",
    items: [
      {
        q: "What do I need before I can start creating?",
        a: [
          "Three things, in order: create an account, verify your email address, and choose a plan. Once all three are done the studio opens and stays open.",
          "Until then, going to the app directly will send you back to whichever step is still outstanding — so there is never a half-set-up account sitting in a broken state.",
        ],
      },
      {
        q: "Is there a free trial?",
        a: [
          "There is no free tier, but there is a $2.99 one-time trial called Explorer. It includes 220 credits — about one standard video plus a few images — and opens all four studios.",
          "It is available once per account, after you verify your email, and it does not renew or auto-charge. The one thing it leaves out is the Seedance 2.5 model family, which is included on every paid plan. When you want more, move to a plan at any time and anything you have already created stays in your library.",
        ],
      },
      {
        q: "What can I actually make?",
        a: [
          "Four studios. <strong>Video Studio</strong> for prompt-driven video, <strong>Product Studio</strong> for product ads built from your own product shots, <strong>App Studio</strong> for app and SaaS showcases, and <strong>Image Studio</strong> for stills and image editing.",
          "Every plan includes all four, plus the preset library, the AI avatar cast, a reusable asset library, and the Explore gallery for inspiration.",
        ],
      },
    ],
  },
  {
    label: "Plans and credits",
    items: [
      {
        q: "How do credits work?",
        a: [
          "Credits are one universal unit spent across every studio and model. What a generation costs depends on the model, resolution, duration and how many outputs you ask for — a short standard clip costs a fraction of a long high-resolution one.",
          "You never have to guess: the exact credit cost is quoted on the generate button before you confirm, and nothing is charged until you do. The same configuration on the same model always quotes the same number, and the figure you agreed to is the figure that is charged — if anything about the quote no longer matches at submission time, the generation is refused rather than silently repriced.",
        ],
      },
      {
        q: "Do unused credits roll over?",
        a: [
          "Yes. Unused credits carry over from period to period and do not expire while your plan is active.",
        ],
      },
      {
        q: "What is the difference between monthly and annual billing?",
        a: [
          "Annual costs 20% less than paying month to month — Starter works out at $23.20/month, Growth at $63.20 and Agency at $143.20. You are charged once, and your credit allowance is then granted <strong>every month</strong> across the twelve months of the term.",
          "That is worth being precise about: annual does not drop a year of credits into your balance on day one. You get the same monthly allowance as the monthly plan, for a lower total price.",
        ],
      },
      {
        q: "Are any models or quality settings locked to the higher tiers?",
        a: [
          "No. Every <strong>paid</strong> plan gets every AI model, every resolution and every clip length the model itself supports — Starter can render exactly what Agency can render. There is no 4K upsell and no duration upsell.",
          "Paid plans differ on two things only: how many credits you get each month, and how many videos you can generate at once. The single exception anywhere is the $2.99 Explorer trial, which excludes the Seedance 2.5 family because one Seedance 2.5 generation would consume most of the trial's allowance in a single click.",
        ],
      },
    ],
  },
  {
    label: "Generating",
    items: [
      {
        q: "How many videos can I generate at the same time?",
        a: [
          "Explorer and Starter generate <strong>one video at a time</strong>. Growth and Agency generate <strong>up to four at once</strong>.",
          "A slot is occupied from the moment you submit until the video finishes and appears in your library. So on Growth you can queue four, and the moment any one of them lands, a slot frees up for the next.",
        ],
      },
      {
        q: "What happens if I try to start more than my plan allows?",
        a: [
          "The submission is declined with a message telling you how many slots are in use, and <strong>no credits are spent</strong> — nothing is reserved, nothing is charged, and your request is left intact so you can submit it as soon as a slot frees.",
          "The studio also shows your slot usage before you commit and disables the generate button when you are at the ceiling, so you should rarely meet this message at all.",
        ],
      },
      {
        q: "Do I need to keep the tab open while a video renders?",
        a: [
          "No. Generation runs entirely on our servers. You can close the tab, refresh, or come back on another device — the job carries on and the result appears in your library, and we recover jobs automatically if a provider goes quiet.",
        ],
      },
    ],
  },
  {
    label: "Billing and account",
    items: [
      {
        q: "Can I cancel or change my plan?",
        a: [
          "You can cancel at any time. Cancelling stops the next renewal and you keep full access, along with your remaining credits, until the end of the period you have already paid for.",
        ],
      },
      {
        q: "What happens if my plan lapses?",
        a: [
          "Access to the studio pauses and you will be brought back to this page. Nothing you have made is deleted — your library and assets are waiting, and starting a plan again restores access to them immediately.",
        ],
      },
      {
        q: "Where can I read the terms?",
        a: [
          'Our <a href="/terms">Terms</a>, <a href="/privacy">Privacy Policy</a> and <a href="/refund-policy">Refund Policy</a> cover billing, acceptable use and how your data and generated content are handled.',
        ],
      },
    ],
  },
];
