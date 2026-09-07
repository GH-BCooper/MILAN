/**
 * The severity badge: priority score → band → colour, one definition shared
 * by the challenges list filter and the cards themselves, so the badge a
 * visitor sees always means exactly the band they filtered by. Task 4.8.
 *
 * The bands cut at 25/50/75 of the 0–100 priority score. Colour is a second
 * signal only, as everywhere else in Milan: the chip's text names the band.
 */
export interface SeverityBand {
  key: "critical" | "high" | "moderate" | "low" | "unscored";
  /** Short label for badges; bracket label for the filter dropdown. */
  label: string;
  min: number | null;
  max: number | null;
  className: string;
}

export const SEVERITY_BANDS: readonly SeverityBand[] = [
  {
    key: "critical",
    label: "critical",
    min: 75,
    max: null,
    className: "border-red-400/40 bg-red-500/15 text-red-200",
  },
  {
    key: "high",
    label: "high",
    min: 50,
    max: 75,
    className: "border-amber-400/40 bg-amber-500/15 text-amber-200",
  },
  {
    key: "moderate",
    label: "moderate",
    min: 25,
    max: 50,
    className: "border-sky-400/40 bg-sky-500/15 text-sky-200",
  },
  {
    key: "low",
    label: "low",
    min: null,
    max: 25,
    className: "border-border bg-muted text-muted-foreground",
  },
] as const;

export const UNSCORED_BAND: SeverityBand = {
  key: "unscored",
  label: "not scored yet",
  min: null,
  max: null,
  className: "border-dashed border-border bg-transparent text-muted-foreground",
};

export function severityBandOf(score: number | null): SeverityBand {
  if (score === null || Number.isNaN(score)) return UNSCORED_BAND;
  return (
    SEVERITY_BANDS.find((b) => (b.min === null || score >= b.min) && (b.max === null || score < b.max)) ??
    UNSCORED_BAND
  );
}

/**
 * The same bands as hex colours, for canvas surfaces (the /stats district
 * heatmap) that cannot read Tailwind classes. Kept next to the className
 * bands so the two never drift silently — if a band's meaning moves, both
 * representations move in the same commit.
 */
export const SEVERITY_BAND_HEX: Record<SeverityBand["key"], string> = {
  critical: "#f87171",
  high: "#fbbf24",
  moderate: "#7dd3fc",
  low: "#94a3b8",
  unscored: "#64748b",
} as const;

export function isSeverityBandKey(value: string | undefined): value is SeverityBand["key"] {
  return value === "unscored" || SEVERITY_BANDS.some((b) => b.key === value);
}

export function SeverityChip({ score }: { score: number | null }) {
  const band = severityBandOf(score);
  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs font-medium ${band.className}`}
      title={
        score === null
          ? "This report has not been through the priority stage yet."
          : `Priority ${score.toFixed(1)} out of 100, banded ${band.label}. Every term is shown on the report's page.`
      }
    >
      {score === null ? "not scored yet" : `${Math.round(score)} · ${band.label}`}
    </span>
  );
}
