"use client";

/**
 * The live countdown to a claim window closing.
 *
 * "Every state has an SLA with an automatic escalation" is one of the five
 * sentences, and a deadline a department cannot see is a deadline it will miss.
 * It ticks because a static "2 days left" reads as decoration; a running clock
 * reads as a commitment.
 *
 * It counts down in MILAN time, not browser time.
 *
 * That distinction is not pedantry. Phase 3's demo console moves the clock
 * forward thirty days so a judge can watch an SLA breach happen in ten seconds.
 * A countdown reading `Date.now()` would sit still through that while every
 * other number on the screen jumped — the one moment the countdown exists for
 * would be the one moment it lied. So the server sends its own `now` alongside
 * the deadline, this component measures the offset between the two clocks once
 * on mount, and ticks from there.
 */
import { useEffect, useState } from "react";

import { browserClockNowMs, clockSkewMs } from "@/lib/clock/browser";

export function ClaimCountdown({
  endsAt,
  serverNow,
  className = "",
}: {
  /** ISO 8601, from the server. */
  endsAt: string;
  /** `clockNow()` at render, so the browser can correct for the demo offset. */
  serverNow: string;
  className?: string;
}) {
  const target = new Date(endsAt).getTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    // How far Milan time is from this browser's clock: the demo offset, plus
    // whatever the viewer's device is wrong by, in one number.
    const skew = clockSkewMs(serverNow);
    const update = () => setRemaining(target - browserClockNowMs(skew));
    // Computed only after mount: rendering a time difference during hydration
    // guarantees a server/client mismatch.
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [target, serverNow]);

  if (remaining === null) {
    return (
      <span className={`font-mono tabular-nums text-muted-foreground ${className}`} aria-hidden>
        —
      </span>
    );
  }

  if (remaining <= 0) {
    return (
      <span className={`font-mono font-semibold tabular-nums text-destructive ${className}`}>
        window closed
      </span>
    );
  }

  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  // Under a day the seconds matter; over a day they are noise.
  const text =
    days > 0
      ? `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
      : `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;

  const urgent = remaining < 48 * 3600 * 1000;

  return (
    <span
      className={`font-mono font-semibold tabular-nums ${urgent ? "text-amber-700" : ""} ${className}`}
      // Announced off: a screen reader reading a ticking clock aloud every
      // second is unusable. The absolute deadline is in the title instead.
      aria-live="off"
      title={`Claim window closes ${new Date(endsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}
    >
      {text}
    </span>
  );
}
