"use client";

import dynamic from "next/dynamic";

import type { MapHeat } from "@/components/milan-map";
import { SEVERITY_BANDS, SEVERITY_BAND_HEX, UNSCORED_BAND } from "@/components/severity-chip";

const MilanMap = dynamic(() => import("@/components/milan-map").then((m) => m.MilanMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading the Jharkhand heatmap…
    </div>
  ),
});

export interface DistrictHeatWeight {
  code: string;
  name: string;
  lat: number;
  lng: number;
  count: number;
  /** 0–100 band scale; null where every report is unscored. */
  avgSeverity: number | null;
}

/**
 * The district heatmap for /stats (Task 4.7). One severity-coloured circle
 * per district over the offline PMTiles basemap: colour = severity band of
 * the district's average, radius = report count. Click-through goes to
 * /challenges pre-filtered to that district, severity-first — one of the
 * two filter URLs Task 4.8 built for exactly this wireframe handoff.
 */
export function DistrictHeatMap({ weights }: { weights: DistrictHeatWeight[] }) {
  const heat: MapHeat[] = weights.map((w) => ({
    id: w.code,
    lat: w.lat,
    lng: w.lng,
    count: w.count,
    avgSeverity: w.avgSeverity,
    label: `${w.name}: ${w.count} report${w.count === 1 ? "" : "s"}${
      w.avgSeverity === null ? " · not scored yet" : ` · average severity ${w.avgSeverity.toFixed(0)}/100`
    }`,
    /* Two filter params the 4.8 bar understands; severity= narrows hot
     * districts to their critical reports, nothing else is invented. */
    href: `/challenges?district=${encodeURIComponent(w.code)}${
      w.avgSeverity !== null && w.avgSeverity >= 75 ? "&severity=critical" : ""
    }`,
  }));

  return (
    <figure className="milan-glass overflow-hidden rounded-xl">
      <div className="h-80 sm:h-96">
        <MilanMap
          className="h-full"
          heat={heat}
          ariaLabel="District heatmap of Jharkhand: circle colour is average severity, size is report count"
        />
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Average severity</span>
        {[...SEVERITY_BANDS, UNSCORED_BAND].map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: SEVERITY_BAND_HEX[b.key] }}
            />
            {b.label}
          </span>
        ))}
        <span className="ms-auto">Circle size = reports. Click a district for its board.</span>
      </figcaption>
    </figure>
  );
}
