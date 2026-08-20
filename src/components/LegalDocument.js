import Link from "next/link";

/**
 * Renders an approved legal document.
 *
 * The documents are authored as plain prose with a deliberately tiny convention —
 * "## " for sections, "### " for subsections, **bold** for emphasis — so the legal
 * text stays reviewable as text and carries no markup that could alter its
 * meaning. Previously these pages dumped the raw string into a `whitespace-pre-line`
 * div, which rendered "## 1. Eligibility" and "**support@doolphin.co**" literally.
 *
 * No markdown dependency is added: a full parser would be a supply-chain and
 * rendering-fidelity risk for the one class of document that must never be
 * misrepresented. Anything not matching the convention renders verbatim.
 */

function Emphasis({ text }) {
  // Split on **bold** spans. Even indices are plain text, odd indices are bold.
  const parts = String(text).split("**");
  return parts.map((part, index) =>
    index % 2 === 1 ? <strong key={index} className="font-semibold text-[#111111]">{part}</strong> : part
  );
}

export default function LegalDocument({ documentKey, document: doc }) {
  const blocks = doc.content.split("\n").filter((line) => line.trim().length > 0);

  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Primary navigation">
        <Link className="wordmark" href="/" aria-label="Doolphin home"><span className="wordmark-mark">d</span>Doolphin</Link>
        <div className="nav-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/sign-in">Log in</Link>
          <Link className="signup-button" href="/sign-up">Sign up <span aria-hidden="true">↗</span></Link>
        </div>
      </nav>

      <article className="legal-document">
        <p className="eyebrow">Legal</p>
        <h1>{doc.title}</h1>

        {blocks.map((line, index) => {
          if (line.startsWith("### ")) {
            return <h3 key={index}>{line.slice(4)}</h3>;
          }
          if (line.startsWith("## ")) {
            return <h2 key={index}>{line.slice(3)}</h2>;
          }
          return <p key={index}><Emphasis text={line} /></p>;
        })}

        <p className="legal-footer-note">
          Questions about this document? Email{" "}
          <a href="mailto:support@doolphin.co">support@doolphin.co</a>. See also our{" "}
          <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy Policy</Link> and{" "}
          <Link href="/refund-policy">Refund Policy</Link>.
        </p>
      </article>

      <footer className="landing-footer">
        <div>
          <Link className="wordmark" href="/"><span className="wordmark-mark">d</span>Doolphin</Link>
          <p>AI video for ideas that deserve to move.</p>
        </div>
        <div className="footer-links">
          <div><p>Explore</p><Link href="/pricing">Pricing</Link></div>
          <div><p>Company</p><a href="mailto:support@doolphin.co">Contact</a></div>
          <div><p>Legal</p><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refund-policy">Refunds</Link></div>
        </div>
        <p className="footer-bottom">© {new Date().getFullYear()} Doolphin Pvt Ltd. Made for big ideas.</p>
      </footer>
    </main>
  );
}
