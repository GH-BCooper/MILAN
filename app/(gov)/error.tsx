"use client";

import { ErrorPanel } from "@/components/error-panel";

/**
 * Phase 1 left this as a known issue: `requireDistrict` correctly refuses a
 * cross-district request but there was no boundary to present the refusal, so a
 * DC of Gumla opening a Dhanbad page got a raw 500. "Refused" and "broken" are
 * different things and the panel says which.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} area="gov" home="/gov" homeLabel="Back to your district" />;
}
