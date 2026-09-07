/** A hand-authored, deliberately schematic outline of India, drawn once as a
 *  path in a 0–1000 box. It is decoration and orientation, not cartography —
 *  the real geometry lives in the MapLibre/PMTiles basemap on /challenges,
 *  which is the only surface allowed to make a spatial claim. Kept as inline
 *  SVG (no image request, no token, works offline) and theme-aware, because
 *  every colour below is a token from globals.css.
 */
const INDIA_PATH =
  "M 452 92 L 470 66 L 500 60 L 520 78 L 548 74 L 566 92 L 604 88 L 620 108 L 616 132 L 590 146 L 596 172 L 626 176 L 660 168 L 688 178 L 700 200 L 736 196 L 762 178 L 790 186 L 806 210 L 800 236 L 820 252 L 848 246 L 866 262 L 858 288 L 830 300 L 812 330 L 790 348 L 772 386 L 748 404 L 730 396 L 716 366 L 700 350 L 676 356 L 660 380 L 640 372 L 624 350 L 600 344 L 588 366 L 600 396 L 620 424 L 636 468 L 652 520 L 660 566 L 646 610 L 628 664 L 606 716 L 578 782 L 548 848 L 520 906 L 498 946 L 476 934 L 462 890 L 440 828 L 416 766 L 392 706 L 366 648 L 340 596 L 314 552 L 288 512 L 262 476 L 240 440 L 222 402 L 214 366 L 226 336 L 252 322 L 276 336 L 300 330 L 316 300 L 306 272 L 282 258 L 262 232 L 268 204 L 292 190 L 300 162 L 322 142 L 352 140 L 372 122 L 400 118 L 420 100 Z";

/** Dots are drawn in the same 0–1000 space as the path above. */
const MARKERS: ReadonlyArray<{
  id: string;
  x: number;
  y: number;
  label: string;
  primary?: boolean;
}> = [
  { id: "jharkhand", x: 604, y: 430, label: "Jharkhand", primary: true },
  { id: "north", x: 470, y: 210, label: "Northern plains" },
  { id: "west", x: 330, y: 430, label: "Western belt" },
  { id: "south", x: 470, y: 760, label: "Southern peninsula" },
  { id: "east", x: 700, y: 330, label: "North-east" },
];

export function IndiaMap({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={className}
      role="img"
      aria-label="Schematic outline of India with Jharkhand marked"
    >
      <defs>
        <linearGradient id="milan-india-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--grad-1)" stopOpacity="0.30" />
          <stop offset="55%" stopColor="var(--grad-2)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--grad-3)" stopOpacity="0.26" />
        </linearGradient>
        <linearGradient id="milan-india-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--grad-1)" />
          <stop offset="100%" stopColor="var(--grad-3)" />
        </linearGradient>
        {/* The dot grid only shows inside the landmass. */}
        <pattern id="milan-india-dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="2.1" fill="var(--grad-2)" fillOpacity="0.35" />
        </pattern>
        <clipPath id="milan-india-clip">
          <path d={INDIA_PATH} />
        </clipPath>
      </defs>

      <path d={INDIA_PATH} fill="url(#milan-india-fill)" />
      <rect
        x="0"
        y="0"
        width="1000"
        height="1000"
        fill="url(#milan-india-dots)"
        clipPath="url(#milan-india-clip)"
      />
      <path
        d={INDIA_PATH}
        fill="none"
        stroke="url(#milan-india-stroke)"
        strokeWidth="6"
        strokeLinejoin="round"
      />

      {MARKERS.map((m) => (
        <g key={m.id}>
          <title>{m.label}</title>
          {m.primary ? (
            <circle cx={m.x} cy={m.y} r="46" fill="var(--grad-3)" fillOpacity="0.14">
              {/* Motion is suppressed by the reduced-motion rule in globals.css. */}
              <animate
                attributeName="r"
                values="26;56;26"
                dur="3.4s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="fill-opacity"
                values="0.26;0;0.26"
                dur="3.4s"
                repeatCount="indefinite"
              />
            </circle>
          ) : null}
          <circle
            cx={m.x}
            cy={m.y}
            r={m.primary ? 15 : 8}
            fill={m.primary ? "var(--grad-3)" : "var(--grad-1)"}
            fillOpacity={m.primary ? 1 : 0.65}
            stroke="var(--background)"
            strokeWidth="3"
          />
        </g>
      ))}

      <text
        x="640"
        y="410"
        fill="var(--foreground)"
        fontSize="30"
        fontWeight="700"
        letterSpacing="1"
      >
        Jharkhand
      </text>
    </svg>
  );
}
