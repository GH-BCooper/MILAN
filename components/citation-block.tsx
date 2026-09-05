"use client";

/**
 * The citation, with a copy button and a BibTeX toggle.
 *
 * "Universities are not doing us a favour." A department head decides whether
 * Milan is worth their students' time partly on whether the output is citable,
 * so the citation is on the public page rather than buried in an export.
 */
import { useState } from "react";

export function CitationBlock({ citation, bibtex }: { citation: string; bibtex: string }) {
  const [showBib, setShowBib] = useState(false);
  const [copied, setCopied] = useState<"none" | "cite" | "bib" | "failed">("none");

  async function copy(text: string, which: "cite" | "bib") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Cite this</h3>
      <p className="mt-2 rounded bg-muted p-3 text-sm">{citation}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => copy(citation, "cite")}
          className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold"
        >
          {copied === "cite" ? "Copied" : "Copy citation"}
        </button>
        <button
          onClick={() => setShowBib((v) => !v)}
          className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold"
        >
          {showBib ? "Hide BibTeX" : "BibTeX"}
        </button>
        {showBib ? (
          <button
            onClick={() => copy(bibtex, "bib")}
            className="inline-flex h-11 items-center rounded-md border border-input px-4 text-sm font-semibold"
          >
            {copied === "bib" ? "Copied" : "Copy BibTeX"}
          </button>
        ) : null}
      </div>
      {copied === "failed" ? (
        <p className="mt-2 text-xs text-red-700">
          Your browser blocked the clipboard. Select the text above and copy it by hand.
        </p>
      ) : null}
      {showBib ? (
        <pre className="mt-2 overflow-auto rounded border border-border bg-muted p-3 text-[11px]">{bibtex}</pre>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        The person who reported the problem is in the author position, before the institution. That is
        deliberate.
      </p>
    </div>
  );
}
