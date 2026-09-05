"use client";

/**
 * The last resort: an error in the root layout itself, where no other boundary
 * can catch it. It has to render its own <html> and cannot use the design
 * tokens, so it is deliberately plain — but it is still not a stack trace.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1.5rem", background: "#f8fafc", color: "#0f172a" }}>
        <div style={{ maxWidth: "36rem", margin: "0 auto", border: "1px solid #cbd5e1", borderRadius: 8, padding: "1.5rem", background: "#fff" }}>
          <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", margin: 0 }}>Milan</p>
          <h1 style={{ fontSize: 20, margin: "0.5rem 0 0" }}>The application could not start.</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>
            This is logged. Nothing you did caused it and nothing was written. The provenance ledger is
            append-only and is unaffected.
          </p>
          {error.digest ? <p style={{ fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>reference {error.digest}</p> : null}
          <button
            onClick={reset}
            style={{ height: 44, padding: "0 1rem", borderRadius: 6, border: "none", background: "#1e3a8a", color: "#fff", fontWeight: 600 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
