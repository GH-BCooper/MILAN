"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

import { SEVERITY_BAND_HEX, severityBandOf } from "@/components/severity-chip";

/**
 * The one map component. Used by the submit wizard to drop a pin and by
 * /challenges and /gov to plot markers.
 *
 * The library is Leaflet — the JDIP document asks for it by name — but the
 * basemap is NOT OpenStreetMap's tile server. Tiles come from the committed
 * Protomaps archive at NEXT_PUBLIC_PMTILES_URL (served same-origin from
 * public/), rendered to canvas by protomaps-leaflet. That choice is invariant
 * 8: a tile server is a vendor that can fail on stage, so the demo must not
 * depend on one. If the archive is unset or unreadable the map still works —
 * it falls back to a blank canvas with our own markers on it and says so.
 *
 * Leaflet, protomaps-leaflet and pmtiles are all window-only and loaded
 * lazily inside the effects, so this module is safe to server-render.
 */

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  href?: string;
  /** Any CSS colour. Status colour is a second signal; the label carries the meaning. */
  colour?: string;
}

const JHARKHAND_CENTRE: [number, number] = [85.3, 23.6]; // [lng, lat], as callers pass it

const FALLBACK_BACKGROUND = "#070a1a";

/**
 * The dark basemap, layer for layer what the old MapLibre style painted, so
 * the switch of renderer changes nothing on the projector: same earth, same
 * water, same roads, same dashed purple boundaries, and no labels — the
 * markers are the information; the basemap is orientation.
 */
function darkPaintRules(mod: typeof import("protomaps-leaflet")): import("protomaps-leaflet").PaintRule[] {
  return [
    { dataLayer: "earth", symbolizer: new mod.PolygonSymbolizer({ fill: "#0b1024" }) },
    { dataLayer: "landuse", symbolizer: new mod.PolygonSymbolizer({ fill: "#0f1533" }) },
    { dataLayer: "water", symbolizer: new mod.PolygonSymbolizer({ fill: "#10224a" }) },
    { dataLayer: "roads", symbolizer: new mod.LineSymbolizer({ color: "#2a3468", width: 1 }) },
    {
      dataLayer: "boundaries",
      symbolizer: new mod.LineSymbolizer({ color: "#7c5cff", width: 1, dash: [2, 2] }),
    },
  ];
}

/** The drop-pin, drawn as inline SVG so no image asset URL is ever requested. */
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
  <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 23 13 23s13-13.25 13-23C26 5.82 20.18 0 13 0z" fill="#b91c1c" stroke="#ffffff" stroke-width="1.5"/>
  <circle cx="13" cy="13" r="5" fill="#ffffff"/>
</svg>`;

/** A severity-weighted district heat circle (Task 4.7's /stats heatmap). */
export interface MapHeat {
  id: string;
  lat: number;
  lng: number;
  /** Reports in this district; scales the circle. */
  count: number;
  /** Average severity on the 0-100 band scale; picks the band colour. */
  avgSeverity: number | null;
  /** Shown verbatim in the tooltip — plain text, never interpolated. */
  label: string;
  /** If set, clicking the circle navigates (district click-through). */
  href?: string;
}

export interface MilanMapProps {
  markers?: MapMarker[];
  /** Heat circles drawn UNDER the markers: severity colour, count radius. */
  heat?: MapHeat[];
  /** When set, clicking the map moves the pin and calls back. */
  pin?: { lat: number; lng: number } | null;
  onPinChange?: (lat: number, lng: number) => void;
  zoom?: number;
  centre?: [number, number]; // [lng, lat]
  className?: string;
  /** Announced to screen readers; the map itself is not keyboard-navigable. */
  ariaLabel: string;
}

export function MilanMap({
  markers = [],
  heat = [],
  pin = null,
  onPinChange,
  zoom = 6.4,
  centre = JHARKHAND_CENTRE,
  className,
  ariaLabel,
}: MilanMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const markerRefs = useRef<import("leaflet").CircleMarker[]>([]);
  const heatRefs = useRef<import("leaflet").CircleMarker[]>([]);
  const pinRef = useRef<import("leaflet").Marker | null>(null);
  const onPinChangeRef = useRef(onPinChange);
  const [basemap, setBasemap] = useState<"loading" | "tiles" | "blank">("loading");

  onPinChangeRef.current = onPinChange;

  /* Create the map once. Whatever happens to the archive, a map exists. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!container.current || map.current) return;
      const L = await import("leaflet");
      if (cancelled || !container.current || map.current) return;

      const instance = L.map(container.current, {
        center: [centre[1], centre[0]],
        zoom,
        zoomControl: true,
      });

      // Root-relative (the default: the archive ships in public/) is made
      // absolute here; a bare "/x.pmtiles" is not guaranteed to survive being
      // handed through the layer machinery.
      const configured = process.env.NEXT_PUBLIC_PMTILES_URL;
      const pmtilesUrl = configured
        ? configured.startsWith("/")
          ? `${window.location.origin}${configured}`
          : configured
        : null;

      let tilesOk = false;
      if (pmtilesUrl) {
        try {
          const { PMTiles } = await import("pmtiles");
          const source = new PMTiles(pmtilesUrl);
          // The canary: a fetch of the 512KB root header proves the archive is
          // there before we draw a single tile onto the demo projector.
          await source.getHeader();
          const protomaps = await import("protomaps-leaflet");
          if (cancelled) return;
          protomaps
            .leafletLayer({
              // The URL string, not our PMTiles instance: protomaps-leaflet
              // builds its own from a pinned older pmtiles, and the two are
              // deliberately not made to hold hands across versions.
              url: pmtilesUrl,
              backgroundColor: FALLBACK_BACKGROUND,
              paintRules: darkPaintRules(protomaps),
              labelRules: [],
              attribution: "© OpenStreetMap · Protomaps",
            })
            .addTo(instance);
          tilesOk = true;
        } catch (e) {
          console.warn(
            "[map] basemap unavailable, falling back to markers only:",
            (e as Error).message,
          );
        }
      }

      if (cancelled) return;

      // The map must exist in the ref BEFORE we flip the status: the marker
      // and pin effects key off this flip, and they no-op while the ref is
      // empty. Assign first, announce second.
      instance.on("click", (e) => {
        onPinChangeRef.current?.(e.latlng.lat, e.latlng.lng);
      });
      map.current = instance;
      setBasemap(pmtilesUrl && tilesOk ? "tiles" : "blank");

      // Leaflet measures its container's size once, at construction. Inside a
      // multi-step wizard the container can still be mid-layout (fonts not
      // painted, the step's height transition not settled) at that instant,
      // which is what "the map sometimes doesn't work" actually is: it comes
      // up sized or centred wrong, silently, with no error. Re-measuring one
      // frame later — after layout has definitely settled — fixes it without
      // guessing at a fixed delay.
      requestAnimationFrame(() => {
        if (!cancelled) instance.invalidateSize();
      });
    })();

    // Keep re-measuring as the container itself changes size (a step
    // transition, a phone rotated, the sidebar collapsing) — the same fix as
    // above, but for every resize after the first, not just the initial one.
    const observer = new ResizeObserver(() => map.current?.invalidateSize());
    if (container.current) observer.observe(container.current);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
    // Centre and zoom are initial values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Markers. Rebuilt wholesale — at 25 challenges this is cheaper than diffing.
     Reruns when the map finishes initialising too (the basemap flip doubles as
     the readiness signal), so markers queued before load are never lost. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      const instance = map.current;
      if (cancelled || !instance) return;

      for (const m of markerRefs.current) m.remove();
      markerRefs.current = [];

      for (const marker of markers) {
        const cm = L.circleMarker([marker.lat, marker.lng], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: marker.colour ?? "#1e3a8a",
          fillOpacity: 1,
        });
        // Popup content is a DOM node, not an HTML string: a challenge title
        // is citizen text and is never interpolated into markup.
        const content = document.createElement(marker.href ? "a" : "span");
        content.textContent = marker.label;
        if (marker.href && content instanceof HTMLAnchorElement) {
          content.href = marker.href;
          content.className = "underline";
        }
        cm.bindPopup(content);
        cm.addTo(instance);
        markerRefs.current.push(cm);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [markers, basemap]);

  /* Heat circles. Same wholesale rebuild discipline as markers. Heat and
     markers are never mixed on one map today (heat is the /stats overview,
     markers are per-challenge pages); if they ever are, draw heat via its
     own lower-z-index pane so pins stay clickable. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      const instance = map.current;
      if (cancelled || !instance) return;

      for (const h of heatRefs.current) h.remove();
      heatRefs.current = [];

      for (const cell of heat) {
        const band = severityBandOf(cell.avgSeverity);
        const hex = SEVERITY_BAND_HEX[band.key];
        const cm = L.circleMarker([cell.lat, cell.lng], {
          // sqrt keeps 25 reports from swallowing the state at this zoom.
          radius: 8 + Math.min(22, Math.sqrt(cell.count) * 5),
          color: hex,
          weight: 1.5,
          fillColor: hex,
          fillOpacity: 0.3,
        });
        cm.bindTooltip(cell.label, { direction: "top" });
        if (cell.href) {
          cm.on("click", () => window.location.assign(cell.href!));
        }
        cm.addTo(instance);
        heatRefs.current.push(cm);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [heat, basemap]);

  /* The draggable pin, when this map is being used to choose a location. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      const instance = map.current;
      if (cancelled || !instance) return;

      if (!pin) {
        pinRef.current?.remove();
        pinRef.current = null;
        return;
      }

      if (!pinRef.current) {
        const icon = L.divIcon({
          className: "milan-pin",
          html: PIN_SVG,
          iconSize: [26, 36],
          iconAnchor: [13, 35],
        });
        pinRef.current = L.marker([pin.lat, pin.lng], { icon, draggable: true }).addTo(instance);
        pinRef.current.on("dragend", () => {
          const p = pinRef.current?.getLatLng();
          if (p) onPinChangeRef.current?.(p.lat, p.lng);
        });
      } else {
        pinRef.current.setLatLng([pin.lat, pin.lng]);
      }

      instance.setView([pin.lat, pin.lng], Math.max(instance.getZoom(), 10), { animate: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [pin, basemap]);

  return (
    <div className={className}>
      <div
        ref={container}
        role="application"
        aria-label={ariaLabel}
        style={{ backgroundColor: FALLBACK_BACKGROUND }}
        className="h-full w-full milan-glass rounded-xl"
      />
      {basemap === "blank" ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Basemap tiles are not loaded, so only the points are shown. Everything on this map still
          works.
        </p>
      ) : null}
    </div>
  );
}
