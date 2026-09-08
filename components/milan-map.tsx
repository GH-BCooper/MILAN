"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";

import { SEVERITY_BAND_HEX, severityBandOf } from "@/components/severity-chip";

/**
 * The one map component. Used by the submit wizard to drop a pin and by
 * /challenges and /gov to plot markers.
 *
 * Locked stack (CLAUDE.md §3): MapLibre GL + Protomaps PMTiles, no API token.
 * The archive is served same-origin from public/ (NEXT_PUBLIC_PMTILES_URL,
 * committed at public/jharkhand.pmtiles) and read via the `pmtiles://`
 * protocol registered with `maplibregl.addProtocol`. That choice is
 * invariant 8: a tile server is a vendor that can fail on stage, so the demo
 * must not depend on one. If the archive is unset or unreadable the map
 * still works — it falls back to a blank canvas with our own markers on it
 * and says so, once, on its own line.
 *
 * maplibre-gl and pmtiles are both window-only and loaded lazily inside the
 * effects, so this module stays safe to import from a server component
 * (see app/(gov)/gov/page.tsx, which imports it directly rather than via
 * next/dynamic).
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
 * The dark basemap style: same earth, same water, same roads, same dashed
 * purple boundaries as the design doc calls for, and no labels — the
 * markers are the information; the basemap is orientation.
 */
function darkStyle(pmtilesUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": FALLBACK_BACKGROUND } },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": "#0b1024" },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": "#0f1533" },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": "#10224a" },
      },
      {
        id: "roads",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: { "line-color": "#2a3468", "line-width": 1 },
      },
      {
        id: "boundaries",
        type: "line",
        source: "protomaps",
        "source-layer": "boundaries",
        paint: { "line-color": "#7c5cff", "line-width": 1, "line-dasharray": [2, 2] },
      },
    ],
  } as unknown as StyleSpecification;
}

/** The blank fallback: solid background, no source, no network request. */
function blankStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": FALLBACK_BACKGROUND } },
    ],
  } as unknown as StyleSpecification;
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
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const markerRefs = useRef<import("maplibre-gl").Marker[]>([]);
  const heatRefs = useRef<import("maplibre-gl").Marker[]>([]);
  const pinRef = useRef<import("maplibre-gl").Marker | null>(null);
  const onPinChangeRef = useRef(onPinChange);
  const [basemap, setBasemap] = useState<"loading" | "tiles" | "blank">("loading");

  onPinChangeRef.current = onPinChange;

  /* Create the map once. Whatever happens to the archive, a map exists. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!container.current || map.current) return;
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !container.current || map.current) return;

      // Root-relative (the default: the archive ships in public/) is made
      // absolute here; a bare "/x.pmtiles" is not guaranteed to survive being
      // handed through the pmtiles:// protocol machinery.
      const configured = process.env.NEXT_PUBLIC_PMTILES_URL;
      const pmtilesUrl = configured
        ? configured.startsWith("/")
          ? `${window.location.origin}${configured}`
          : configured
        : null;

      let tilesOk = false;
      let style = blankStyle();
      if (pmtilesUrl) {
        try {
          const pmtiles = await import("pmtiles");
          const protocol = new pmtiles.Protocol();
          maplibregl.addProtocol("pmtiles", protocol.tile);
          const source = new pmtiles.PMTiles(pmtilesUrl);
          protocol.add(source);
          // The canary: a fetch of the archive's root header proves it is
          // there before we draw a single tile onto the demo projector.
          await source.getHeader();
          if (cancelled) return;
          style = darkStyle(pmtilesUrl);
          tilesOk = true;
        } catch (e) {
          console.warn(
            "[map] basemap unavailable, falling back to markers only:",
            (e as Error).message,
          );
        }
      }

      if (cancelled) return;

      const instance = new maplibregl.Map({
        container: container.current,
        style,
        center: centre,
        zoom,
        attributionControl: { compact: true },
      });
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      instance.on("click", (e) => {
        onPinChangeRef.current?.(e.lngLat.lat, e.lngLat.lng);
      });

      // The map must exist in the ref BEFORE we flip the status: the marker
      // and pin effects key off this flip, and they no-op while the ref is
      // empty. Assign first, announce second.
      const announce = () => {
        if (cancelled) return;
        map.current = instance;
        setBasemap(pmtilesUrl && tilesOk ? "tiles" : "blank");
        // A map created inside a still-settling layout (a multi-step wizard
        // step, a fonts-not-painted first frame) sometimes measures its
        // container wrong. Re-measuring one frame after "load" fixes it
        // without guessing at a fixed delay.
        requestAnimationFrame(() => {
          if (!cancelled) instance.resize();
        });
      };
      instance.once("load", announce);
    })();

    // Keep re-measuring as the container itself changes size (a step
    // transition, a phone rotated, the sidebar collapsing).
    const observer = new ResizeObserver(() => map.current?.resize());
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
      const maplibregl = (await import("maplibre-gl")).default;
      const instance = map.current;
      if (cancelled || !instance) return;

      for (const m of markerRefs.current) m.remove();
      markerRefs.current = [];

      for (const marker of markers) {
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "50%";
        el.style.border = "2px solid #ffffff";
        el.style.background = marker.colour ?? "#1e3a8a";
        el.style.cursor = "pointer";
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.35)";

        // Popup content is a DOM node, not an HTML string: a challenge title
        // is citizen text and is never interpolated into markup.
        const content = document.createElement(marker.href ? "a" : "span");
        content.textContent = marker.label;
        if (marker.href && content instanceof HTMLAnchorElement) {
          content.href = marker.href;
          content.className = "underline";
        }
        const popup = new maplibregl.Popup({ closeButton: true, offset: 10 }).setDOMContent(content);

        const gl = new maplibregl.Marker({ element: el })
          .setLngLat([marker.lng, marker.lat])
          .setPopup(popup)
          .addTo(instance);
        markerRefs.current.push(gl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [markers, basemap]);

  /* Heat circles. Same wholesale rebuild discipline as markers. Heat and
     markers are never mixed on one map today (heat is the /stats overview,
     markers are per-challenge pages); if they ever are, heat should move to
     its own layer under the marker layer so pins stay clickable. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      const instance = map.current;
      if (cancelled || !instance) return;

      for (const h of heatRefs.current) h.remove();
      heatRefs.current = [];

      for (const cell of heat) {
        const band = severityBandOf(cell.avgSeverity);
        const hex = SEVERITY_BAND_HEX[band.key];
        // sqrt keeps 25 reports from swallowing the state at this zoom.
        const diameter = 2 * (8 + Math.min(22, Math.sqrt(cell.count) * 5));

        const el = document.createElement("div");
        el.style.width = `${diameter}px`;
        el.style.height = `${diameter}px`;
        el.style.borderRadius = "50%";
        el.style.border = `1.5px solid ${hex}`;
        el.style.background = hex;
        el.style.opacity = "0.3";
        el.title = cell.label;
        if (cell.href) {
          el.style.cursor = "pointer";
          el.addEventListener("click", () => window.location.assign(cell.href!));
        }

        const gl = new maplibregl.Marker({ element: el })
          .setLngLat([cell.lng, cell.lat])
          .addTo(instance);
        heatRefs.current.push(gl);
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
      const maplibregl = (await import("maplibre-gl")).default;
      const instance = map.current;
      if (cancelled || !instance) return;

      if (!pin) {
        pinRef.current?.remove();
        pinRef.current = null;
        return;
      }

      if (!pinRef.current) {
        const el = document.createElement("div");
        el.innerHTML = PIN_SVG;
        el.style.cursor = "grab";
        pinRef.current = new maplibregl.Marker({ element: el, draggable: true, anchor: "bottom" })
          .setLngLat([pin.lng, pin.lat])
          .addTo(instance);
        pinRef.current.on("dragend", () => {
          const p = pinRef.current?.getLngLat();
          if (p) onPinChangeRef.current?.(p.lat, p.lng);
        });
      } else {
        pinRef.current.setLngLat([pin.lng, pin.lat]);
      }

      instance.easeTo({ center: [pin.lng, pin.lat], zoom: Math.max(instance.getZoom(), 10) });
    })();

    return () => {
      cancelled = true;
    };
  }, [pin, basemap]);

  return (
    <div className={`flex h-full flex-col ${className ?? ""}`}>
      <div
        ref={container}
        role="application"
        aria-label={ariaLabel}
        style={{ backgroundColor: FALLBACK_BACKGROUND }}
        className="milan-glass min-h-0 flex-1 rounded-xl"
      />
      {basemap === "blank" ? (
        <p className="mt-1 shrink-0 text-xs text-muted-foreground">
          Basemap tiles are not loaded, so only the points are shown — everything else on this map
          still works.
        </p>
      ) : null}
    </div>
  );
}
