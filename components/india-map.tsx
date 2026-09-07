"use client";

/** A real, geographically accurate outline of India via @react-map/india,
 *  with Jharkhand picked out — decoration and orientation for the landing
 *  page, not the spatial source of truth. The real geometry for a specific
 *  report lives in the MapLibre/PMTiles basemap on /challenges, which is the
 *  only surface allowed to make a spatial claim.
 *
 *  The library bakes literal colour strings into SVG fill/stroke attributes
 *  rather than reliably resolving CSS custom properties, so the palette below
 *  is copied from the dark-theme brand gradient tokens in globals.css instead
 *  of referenced with var(...).
 */
import India from "@react-map/india";

const OTHER_STATE_COLOR = "#40916c26"; // --grad-3 (sage) at low opacity
const STROKE_COLOR = "#52b78888"; // forest green at medium opacity
const HOVER_COLOR = "#40916c55";
const JHARKHAND_COLOR = "#74c69d"; // sage, solid — the one state that matters here

export function IndiaMap({ className = "" }: { className?: string }) {
  return (
    // The library sets a fixed pixel width via inline style on its own wrapper
    // (`.map`), which `size` below only seeds — override it back to 100% so the
    // map scales with whatever width this component is given.
    <div className={`[&_.map]:!w-full [&_.map]:!h-auto ${className}`}>
      <India
        type="select-single"
        size={480}
        mapColor={OTHER_STATE_COLOR}
        strokeColor={STROKE_COLOR}
        strokeWidth={1.5}
        hoverColor={HOVER_COLOR}
        selectColor={HOVER_COLOR}
        cityColors={{ Jharkhand: JHARKHAND_COLOR }}
      />
    </div>
  );
}
