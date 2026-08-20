"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PLAN_BY_CODE,
  PLAN_FEATURES,
  PLAN_TAGLINES,
  PUBLIC_PLAN_CODES,
  RECOMMENDED_PLAN_CODE,
  TRIAL_PLAN_CODE,
} from "@/lib/entitlements/plan-catalog";
import { FAQ_GROUPS } from "./faq";
// landing.css carries the public-site chrome AND, critically, the rule that
// re-enables vertical scrolling (globals.css sets `body { overflow: hidden }` for
// the app shell). Without this import a visitor arriving directly at /pricing
// gets a clipped, unscrollable page.
import "../landing.css";
import "./pricing.css";

/**
 * Credits consumed by a representative standard Video Studio generation, used
 * only to translate a credit allowance into an "about this many videos" figure.
 *
 * Labelled as an estimate everywhere it appears, because it genuinely is one:
 * real cost varies with model, resolution, duration and output count, and the
 * authoritative number is the quote shown on the generate button. A credit
 * balance alone is meaningless to someone who has never used the product, so an
 * honest estimate with a visible caveat serves them better than no figure.
 */
const STANDARD_VIDEO_CREDITS = 30;

const ANNUAL_DISCOUNT_LABEL = "20% off";

function annualCodeFor(monthlyCode) {
  return monthlyCode.replace("_MONTHLY", "_ANNUAL");
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#E6D9FF" stroke="#111111" strokeOpacity="0.28" />
      <path d="M6 10.4l2.5 2.4L14 7.6" fill="none" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PricingNav() {
  return (
    <nav className="landing-nav" aria-label="Primary navigation">
      <Link className="wordmark" href="/" aria-label="Doolphin home"><span className="wordmark-mark">d</span>Doolphin</Link>
      <div className="nav-links">
        <Link href="/pricing" aria-current="page">Pricing</Link>
        <Link href="/sign-in">Log in</Link>
        <Link className="signup-button" href="/sign-up">Sign up <span aria-hidden="true">↗</span></Link>
      </div>
    </nav>
  );
}

function PricingFooter() {
  return (
    <footer className="landing-footer">
      <div>
        <Link className="wordmark" href="/"><span className="wordmark-mark">d</span>Doolphin</Link>
        <p>AI video for ideas that deserve to move.</p>
      </div>
      <div className="footer-links">
        <div><p>Explore</p><Link href="/pricing">Pricing</Link><span aria-label="Coming soon">AI <small>Coming soon</small></span></div>
        <div><p>Company</p><span aria-label="Coming soon">About <small>Coming soon</small></span><span aria-label="Coming soon">Contact <small>Coming soon</small></span></div>
        <div><p>Legal</p><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div>
      </div>
      <p className="footer-bottom">© {new Date().getFullYear()} Doolphin. Made for big ideas.</p>
    </footer>
  );
}

function BillingToggle({ annual, onChange }) {
  const options = [
    { id: "monthly", label: "Monthly", active: !annual },
    { id: "annual", label: "Yearly", active: annual, badge: ANNUAL_DISCOUNT_LABEL },
  ];
  return (
    <div className="billing-toggle" role="group" aria-label="Billing period">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-active={option.active}
          aria-pressed={option.active}
          onClick={() => onChange(option.id === "annual")}
        >
          {/* A shared layoutId lets the highlight slide between the two options
              instead of blinking, which is the same mechanic used by the studio's
              mode selector. */}
          {option.active && (
            <motion.span
              layoutId="billing-toggle-pill"
              className="billing-toggle-pill"
              initial={false}
              transition={{ type: "spring", stiffness: 480, damping: 34 }}
            />
          )}
          <span>{option.label}</span>
          {option.badge && <span className="save-badge">{option.badge}</span>}
        </button>
      ))}
    </div>
  );
}

function PlanCard({ monthlyCode, annual, onChoose, pendingCode, isCurrent, disabled }) {
  const plan = annual ? PLAN_BY_CODE[annualCodeFor(monthlyCode)] : PLAN_BY_CODE[monthlyCode];
  const monthlyPlan = PLAN_BY_CODE[monthlyCode];
  const featured = monthlyCode === RECOMMENDED_PLAN_CODE;
  const features = PLAN_FEATURES[plan.name];
  const pending = pendingCode === plan.code;

  // Annual is quoted as a monthly-equivalent so the two toggle states are
  // directly comparable; the real amount charged is stated immediately beneath it
  // rather than hidden behind the toggle.
  const monthlyEquivalent = annual
    ? (plan.priceMicroUsd / 12_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (monthlyPlan.priceMicroUsd / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 0 });

  const estimatedVideos = Math.round(plan.credits / STANDARD_VIDEO_CREDITS);

  return (
    <article className="plan-card" data-featured={featured}>
      {featured && <span className="plan-badge">Most popular</span>}

      <h2 className="plan-name">{plan.name}</h2>

      <p className="plan-price">
        <b>${monthlyEquivalent}</b>
        <i>/mo</i>
      </p>

      <p className="plan-billing-note">
        {annual ? (
          <>
            <span>Billed as {plan.price}</span>
            <span className="save-badge">{ANNUAL_DISCOUNT_LABEL}</span>
          </>
        ) : (
          <span>Billed monthly</span>
        )}
      </p>

      <p className="plan-tagline">{PLAN_TAGLINES[plan.name]}</p>

      <div className="plan-stats">
        <div>
          <b>{plan.videoSlots}</b>
          <span>At a time</span>
        </div>
        <div>
          <b>≈{estimatedVideos}</b>
          <span>Videos/mo</span>
        </div>
        <div>
          <b>{plan.credits.toLocaleString()}</b>
          <span>Credits/mo</span>
        </div>
      </div>

      <button
        type="button"
        className="plan-cta"
        data-current={isCurrent}
        disabled={disabled || pending || isCurrent}
        aria-busy={pending}
        onClick={() => onChoose(plan.code)}
      >
        {isCurrent ? "Current plan" : pending ? "Opening checkout…" : `Choose ${plan.name}`}
      </button>

      <p className="plan-cancel-note">{isCurrent ? "Manage billing from the app" : "Cancel anytime."}</p>

      <div className="plan-includes">
        {features?.inherits && <p className="plan-inherits">Everything in {features.inherits}, plus:</p>}
        <ul className="plan-features">
          {features?.items.map((item) => (
            <li key={item.label}>
              <CheckIcon />
              <span>
                {item.label}
                {item.detail && <em> — {item.detail}</em>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function FaqItem({ item, isOpen, onToggle, id }) {
  return (
    <div className="faq-item">
      <button
        type="button"
        className="faq-question"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={onToggle}
      >
        <span>{item.q}</span>
        <span className="faq-chevron" aria-hidden="true">▾</span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={id}
            className="faq-answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            <div>
              {item.a.map((paragraph, index) => (
                // Copy is authored in this repo, not user input, and carries only
                // <strong>/<a> for emphasis and internal links.
                // eslint-disable-next-line react/no-danger
                <p key={index} dangerouslySetInnerHTML={{ __html: paragraph }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PricingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [annual, setAnnual] = useState(false);
  const [pendingCode, setPendingCode] = useState("");
  const [error, setError] = useState("");
  const [openQuestion, setOpenQuestion] = useState(null);
  const [viewer, setViewer] = useState(null);

  const returningFromCheckout = params.get("checkout") === "complete";
  const [activationPending, setActivationPending] = useState(returningFromCheckout);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/trial-eligibility")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled && data) setViewer(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /**
   * POST-CHECKOUT ACTIVATION LAG.
   *
   * Polar confirms payment to the browser before its webhook has necessarily
   * reached us, and the entitlement that unlocks /app is created by that webhook.
   * Sending a paying customer straight to /app would hit the access gate and
   * bounce them back here — which looks exactly like a failed payment.
   *
   * So we hold them on an explicit "finishing activation" state and poll until
   * the entitlement lands, then forward them in. Polling is capped: if the
   * webhook is genuinely delayed we say so and point at support rather than
   * spinning forever.
   */
  useEffect(() => {
    if (!returningFromCheckout) return undefined;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30; // ~60s at a 2s interval

    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (data?.user?.planCode) {
            if (!cancelled) {
              window.clearInterval(timer);
              router.replace("/app");
            }
            return;
          }
        }
      } catch {}
      if (attempts >= maxAttempts && !cancelled) {
        window.clearInterval(timer);
        setActivationPending(false);
        setError("Your payment went through, but activation is taking longer than usual. Refresh in a moment — if it persists, contact us and we will sort it out right away.");
      }
    };

    const timer = window.setInterval(poll, 2000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [returningFromCheckout, router]);

  const startCheckout = useCallback(async (planCode) => {
    setError("");

    // Steps 1 and 2 of the access gate are prerequisites for buying anything,
    // because an entitlement has to attach to a verified identity. Send the user
    // to the step they are missing and bring them straight back here afterwards
    // instead of letting checkout fail and explaining it after the fact.
    if (viewer && !viewer.authenticated) {
      router.push(`/sign-in?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    if (viewer && viewer.authenticated && !viewer.emailVerified) {
      router.push("/verify-email");
      return;
    }

    setPendingCode(planCode);
    try {
      const response = await fetch("/api/checkout/polar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = await response.json();

      if (data.url) {
        location.assign(data.url);
        return;
      }
      if (response.status === 401) {
        router.push(`/sign-in?next=${encodeURIComponent("/pricing")}`);
        return;
      }
      if (data.code === "EMAIL_VERIFICATION_REQUIRED") {
        router.push("/verify-email");
        return;
      }
      setError(data.error || "Checkout is unavailable right now. Please try again.");
    } catch {
      setError("We could not reach checkout. Check your connection and try again.");
    } finally {
      setPendingCode("");
    }
  }, [router, viewer]);

  // The Explorer trial is shown ONLY to a signed-in, verified account that has
  // never activated. It is not a public offer: it cannot be honoured anonymously
  // (the entitlement binds to an identity), it is once per account, and putting
  // "$2.99" in front of a first-time visitor next to $29/month would anchor the
  // whole page against itself. Server-side eligibility in
  // /api/checkout/polar is the authority; this only decides whether to ask.
  const showTrial = Boolean(viewer?.authenticated && viewer.emailVerified && viewer.trialEligible);
  const trialPlan = PLAN_BY_CODE[TRIAL_PLAN_CODE];

  const faqIndex = useMemo(() => {
    let counter = 0;
    return FAQ_GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, key: `faq-${counter++}` })),
    }));
  }, []);

  return (
    <main className="landing-page pricing-page">
      <PricingNav />

      <section className="pricing-hero" aria-labelledby="pricing-title">
        <p className="eyebrow">Plans <span>✦</span> Simple, universal credits</p>
        <h1 id="pricing-title">Pick your <em>pace.</em></h1>
        <p>
          Every plan unlocks every studio and every model. What changes is how much
          you make, and how much of it you make at once.
        </p>
        <BillingToggle annual={annual} onChange={setAnnual} />
      </section>

      {activationPending && (
        <div className="activation-banner" role="status">
          <h2>Finishing your activation…</h2>
          <p>Payment received. We are switching your account on now — this usually takes a few seconds and you will be taken straight to the studio.</p>
        </div>
      )}

      {error && <p className="checkout-error" role="alert">{error}</p>}

      <div className="plan-grid">
        {PUBLIC_PLAN_CODES.map((code) => (
          <PlanCard
            key={code}
            monthlyCode={code}
            annual={annual}
            onChoose={startCheckout}
            pendingCode={pendingCode}
            isCurrent={viewer?.activePlanCode === (annual ? annualCodeFor(code) : code)}
            disabled={Boolean(pendingCode) || activationPending}
          />
        ))}
      </div>

      {showTrial && (
        <p className="trial-line">
          Not ready to commit?{" "}
          <button
            type="button"
            disabled={Boolean(pendingCode) || activationPending}
            aria-busy={pendingCode === TRIAL_PLAN_CODE}
            onClick={() => startCheckout(TRIAL_PLAN_CODE)}
          >
            {pendingCode === TRIAL_PLAN_CODE
              ? "Opening checkout…"
              : `Start with a ${trialPlan.price} trial →`}
          </button>
        </p>
      )}

      <p className="pricing-fineprint">
        Credits roll over and never expire while your plan is active. Video and
        image estimates assume a standard-model generation — the exact credit cost
        is always shown before you generate. Annual plans are charged once and
        grant your credit allowance every month for twelve months.
      </p>

      <section className="faq-section" aria-labelledby="faq-title">
        <header>
          <p className="eyebrow">Good questions</p>
          <h2 id="faq-title">Frequently asked,<br /><em>plainly answered.</em></h2>
          <p>Trials, credits, how many videos you can run at once, billing, and what happens when a plan ends.</p>
        </header>

        {faqIndex.map((group) => (
          <div key={group.label}>
            <p className="faq-group-label">{group.label}</p>
            {group.items.map((item) => (
              <FaqItem
                key={item.key}
                id={item.key}
                item={item}
                isOpen={openQuestion === item.key}
                onToggle={() => setOpenQuestion(openQuestion === item.key ? null : item.key)}
              />
            ))}
          </div>
        ))}
      </section>

      <section className="pricing-outro">
        <h2>Still deciding?</h2>
        <p>Make one video. It is the fastest way to know.</p>
        <Link className="signup-button" href="/sign-up">Sign up <span aria-hidden="true">↗</span></Link>
      </section>

      <PricingFooter />
    </main>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingContent />
    </Suspense>
  );
}
