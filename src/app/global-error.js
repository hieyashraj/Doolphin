"use client";

/**
 * LAST-RESORT BOUNDARY. Catches failures in the root layout itself, where the
 * normal error boundary cannot render. It must supply its own <html>/<body>, and
 * must not depend on app CSS or providers — so the styling here is deliberately
 * inline and self-contained.
 */
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#FAF8ED", color: "#111111", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center", border: "1px solid #111111", borderRadius: 28, background: "#ffffff", boxShadow: "6px 6px 0 #111111" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#77746D" }}>Doolphin</p>
          <h1 style={{ margin: "12px 0 0", fontSize: 28, lineHeight: 1.15 }}>We could not load the app.</h1>
          <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.6, color: "#55534E" }}>
            This is on us, not you. Nothing was charged. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 24, minHeight: 44, width: "100%", borderRadius: 12, border: "1px solid #111111", background: "#E6D9FF", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "3px 3px 0 #111111" }}
          >
            Try again
          </button>
          {error?.digest && (
            <p style={{ marginTop: 18, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#918D82" }}>Reference: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
