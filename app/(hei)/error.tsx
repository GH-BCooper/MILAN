"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} area="hei" home="/hei" homeLabel="Back to your department" />;
}
