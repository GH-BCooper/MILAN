"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Copy to clipboard, with a visible confirmation.
 *
 * `navigator.clipboard` is unavailable on an insecure origin and in some older
 * Android browsers, so a failure is reported rather than swallowed — the citizen
 * needs to know whether the number is actually on their clipboard.
 */
export function CopyButton({
  value,
  label,
  absolute = false,
}: {
  value: string;
  label: string;
  /** Prefix with the current origin, for copying a shareable link. */
  absolute?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const text = absolute && typeof window !== "undefined" ? `${window.location.origin}${value}` : value;
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <Button type="button" variant="outline" onClick={copy}>
      {state === "copied" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Press and hold to copy" : label}
      </span>
    </Button>
  );
}
