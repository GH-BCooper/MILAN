"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

import type { MapMarker } from "@/components/milan-map";

// MapLibre reaches for `window` on import, so it cannot be server-rendered.
const MilanMap = dynamic(() => import("@/components/milan-map").then((m) => m.MilanMap), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-muted sm:h-96" />,
});

/**
 * The map half of /challenges. It is a client component fed entirely by the
 * server component beside it — it does no fetching of its own, so the list and
 * the map can never disagree about what is on screen.
 */
export function ChallengeMap({ markers }: { markers: MapMarker[] }) {
  const stable = useMemo(() => markers, [markers]);

  return (
    <div>
      <div className="h-72 sm:h-96">
        <MilanMap
          ariaLabel="Map of reported problems across Jharkhand. The list below contains the same information."
          className="h-full"
          markers={stable}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {stable.length} of the reports below have a location pin. The list is the complete record.
      </p>
    </div>
  );
}
