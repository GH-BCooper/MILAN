/**
 * CLAUDE.md is unambiguous here and PHASE_3_BUILD.md Task 3.1 calls it
 * non-negotiable: a judge must never be misled about the date. If the demo
 * clock is offset, every page in the product says so, above everything else,
 * in amber, with no way to dismiss it.
 */
import { clockNow } from "@/lib/clock";
import { clockOffsetDays, emergencyState } from "@/lib/clock/server";

function formatted(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export async function DemoClockBanner() {
  const [offset, emergency] = await Promise.all([clockOffsetDays(), emergencyState()]);
  if (offset === 0 && !emergency.on) return null;

  return (
    <div className="w-full">
      {offset !== 0 ? (
        <div
          role="status"
          className="bg-amber-400 text-amber-950 text-xs sm:text-sm font-semibold px-3 py-2 text-center"
        >
          Demo clock: {offset > 0 ? "+" : ""}
          {offset} day{Math.abs(offset) === 1 ? "" : "s"} — the platform is behaving as if today were{" "}
          {formatted(clockNow())}. Nothing on this page is dated in real time.
        </div>
      ) : null}
      {emergency.on ? (
        <div
          role="status"
          className="bg-red-600 text-white text-xs sm:text-sm font-semibold px-3 py-2 text-center"
        >
          Emergency filter active
          {emergency.hazard ? `: ${emergency.hazard.replace(/_/g, " ")}` : ""} — this changes what is shown
          and how it is sorted. It does not change any stored priority score.
        </div>
      ) : null}
    </div>
  );
}
