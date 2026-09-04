"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * The one map component. Used by the submit wizard to drop a pin and by
 * /challenges to plot markers.
 *
 * Basemap: Protomaps PMTiles read over HTTP range requests. No token, no quota,
 * no vendor to fail on stage. If NEXT_PUBLIC_PMTILES_URL is not set — or the
 * archive cannot be fetched — the map still works: it falls back to a blank
 * canvas with our own markers on it and says so. The demo must never depend on
 * a tile server answering.
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

const JHARKHAND_CENTRE: [number, number] = [85.3, 23.6];

/** A style with no sources at all. Markers still render; there is just no basemap. */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: undefined,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eef1f5" } }],
};

function pmtilesStyle(url: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${url}`, attribution: "© OpenStreetMap, Protomaps" },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#eef1f5" } },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": "#f7f8fa" },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": "#c6d9e8" },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": "#e8eee4" },
      },
      {
        id: "roads",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: { "line-color": "#d9dee5", "line-width": 1 },
      },
      {
        id: "boundaries",
        type: "line",
        source: "protomaps",
        "source-layer": "boundaries",
        paint: { "line-color": "#9aa5b1", "line-width": 1, "line-dasharray": [2, 2] },
      },
    ],
  };
}

export interface MilanMapProps {
  markers?: MapMarker[];
  /** When set, clicking the map moves the pin and calls back. */
  pin?: { lat: number; lng: number } | null;
  onPinChange?: (lat: number, lng: number) => void;
  zoom?: number;
  centre?: [number, number];
  className?: string;
  /** Announced to screen readers; the map itself is not keyboard-navigable. */
  ariaLabel: string;
}

export function MilanMap({
  markers = [],
  pin = null,
  onPinChange,
  zoom = 6.4,
  centre = JHARKHAND_CENTRE,
  className,
  ariaLabel,
}: MilanMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const pinRef = useRef<maplibregl.Marker | null>(null);
  const onPinChangeRef = useRef(onPinChange);
  const [basemap, setBasemap] = useState<"loading" | "tiles" | "blank">("loading");

  onPinChangeRef.current = onPinChange;

  useEffect(() => {
    if (!container.current || map.current) return;

    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const pmtilesUrl = process.env.NEXT_PUBLIC_PMTILES_URL;
    const instance = new maplibregl.Map({
      container: container.current,
      style: pmtilesUrl ? pmtilesStyle(pmtilesUrl) : BLANK_STYLE,
      center: centre,
      zoom,
      attributionControl: false,
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // A missing or unreachable archive must degrade, not break. MapLibre reports
    // it as a source error; we swap to the blank style and carry on.
    instance.on("error", (e) => {
      if (!pmtilesUrl) return;
      console.warn("[map] basemap unavailable, falling back to markers only", e.error?.message);
      setBasemap((current) => {
        if (current === "blank") return current;
        try {
          instance.setStyle(BLANK_STYLE);
        } catch {
          /* the map may already be torn down */
        }
        return "blank";
      });
    });

    instance.on("load", () => setBasemap(pmtilesUrl ? "tiles" : "blank"));

    instance.on("click", (e) => {
      onPinChangeRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });

    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
      maplibregl.removeProtocol("pmtiles");
    };
    // Centre and zoom are initial values only; changing them later is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Markers. Rebuilt wholesale — at 25 challenges this is cheaper than diffing. */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const m of markerRefs.current) m.remove();
    markerRefs.current = [];

    for (const marker of markers) {
      const el = document.createElement(marker.href ? "a" : "div");
      el.className =
        "block size-3.5 rounded-full border-2 border-white shadow ring-1 ring-black/20 focus-visible:outline-2 focus-visible:outline-offset-2";
      el.style.backgroundColor = marker.colour ?? "#1e3a8a";
      el.setAttribute("aria-label", marker.label);
      el.setAttribute("title", marker.label);
      if (marker.href && el instanceof HTMLAnchorElement) el.href = marker.href;

      markerRefs.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([marker.lng, marker.lat]).addTo(instance),
      );
    }
  }, [markers]);

  /* The draggable pin, when this map is being used to choose a location. */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    if (!pin) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }

    if (!pinRef.current) {
      pinRef.current = new maplibregl.Marker({ color: "#b91c1c", draggable: true })
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
  }, [pin]);

  return (
    <div className={className}>
      <div
        ref={container}
        role="application"
        aria-label={ariaLabel}
        className="h-full w-full rounded-lg border border-border"
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
