import Link from "next/link";

/**
 * Branded 404. Also the page a non-admin receives at /admin, where returning a
 * 404 rather than a 403 deliberately avoids confirming that an admin console
 * exists at that path.
 */
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#FAF8ED", color: "#111111", padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#77746D" }}>404</p>
        <h1 style={{ margin: "12px 0 0", fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 56, lineHeight: 0.95, letterSpacing: "-0.04em" }}>
          Nothing to see here.
        </h1>
        <p style={{ margin: "16px 0 28px", fontSize: 15, lineHeight: 1.6, color: "#55534E" }}>
          The page you were looking for does not exist, or it moved.
        </p>
        <Link
          href="/"
          style={{ display: "inline-flex", minHeight: 45, alignItems: "center", gap: 9, padding: "11px 20px", border: "1.5px solid #111111", borderRadius: 12, background: "#E6D9FF", boxShadow: "3px 3px 0 #111111", fontSize: 14, fontWeight: 750, color: "#111111", textDecoration: "none" }}
        >
          Back to Doolphin ↗
        </Link>
      </div>
    </main>
  );
}
