"use client";

/**
 * The privacy step before a photo ever leaves the citizen's phone.
 *
 * The declared stub used to read "face and number-plate blurring is not
 * implemented". Now the citizen blurs faces and plates themselves, in the
 * browser, on a canvas, BEFORE upload: what they blur never exists unblurred
 * anywhere but their own device, which is a stronger promise than any
 * server-side pipeline (there is no un-blurred original to leak).
 *
 * What this is not, and says so in the UI: automatic detection. No model runs
 * here — invariant 8 applies to privacy tooling too — so nothing detects a
 * face the citizen did not tap. The honest trade is on the screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Undo2 } from "lucide-react";

interface Region {
  x: number;
  y: number;
  r: number;
}

export interface PhotoBlurAttach {
  /** The (possibly re-encoded) file to upload. */
  file: File;
  /** True when at least one blur region was baked in. */
  facesBlurred: boolean;
}

const BLUR_SIZES = [
  { id: "small", label: "Small", factor: 0.055 },
  { id: "medium", label: "Medium", factor: 0.09 },
  { id: "large", label: "Large", factor: 0.14 },
] as const;

/** Display cap. The server re-encodes to ≤2000px anyway; this keeps taps precise on a phone. */
const MAX_DISPLAY = 1400;

export function PhotoBlur({
  file,
  onAttach,
  onCancel,
  busy,
}: {
  file: File;
  onAttach: (attach: PhotoBlurAttach) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [size, setSize] = useState<(typeof BLUR_SIZES)[number]["id"]>("medium");
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /* Load the chosen file into an image, then draw it once. */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      const scale = Math.min(1, MAX_DISPLAY / Math.max(img.width, img.height));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setNote("This browser could not open the photo for editing. You can attach it unblurred below.");
        setReady(false);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    img.onerror = () => setNote("That photo could not be opened for editing.");
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const region of regions) pixelate(ctx, region);
  }, [regions]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready, redraw]);

  const radius = () => {
    const canvas = canvasRef.current;
    if (!canvas) return 40;
    const f = BLUR_SIZES.find((s) => s.id === size)?.factor ?? 0.09;
    return Math.max(24, Math.round(Math.min(canvas.width, canvas.height) * f));
  };

  /** Tap (or Enter, at the last tapped spot / centre) to place a blur. */
  const addRegionAt = (x: number, y: number) => {
    setRegions((prev) => [...prev, { x, y, r: radius() }]);
  };

  const onCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    addRegionAt(x, y);
  };

  const attach = async (blurred: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) {
      // Could not edit (old browser, odd format): attach the original bytes
      // and record the truth — not blurred.
      onAttach({ file, facesBlurred: false });
      return;
    }
    if (!blurred || regions.length === 0) {
      onAttach({ file, facesBlurred: false });
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      onAttach({ file, facesBlurred: false });
      return;
    }
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    onAttach({ file: new File([blob], name, { type: "image/jpeg" }), facesBlurred: true });
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-semibold">Blur faces and number plates first</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Tap every face and every number plate in this photo. The blur is applied on your phone
        before anything is uploaded — the unblurred photo never leaves this device. This is not
        automatic detection: what you do not tap is not blurred.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {BLUR_SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSize(s.id)}
            aria-pressed={size === s.id}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${
              size === s.id ? "border-primary bg-primary/10 text-primary" : "border-border"
            }`}
          >
            {s.label} blur
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRegions([])}
          disabled={regions.length === 0}
          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50"
        >
          <Undo2 aria-hidden className="size-4" /> Clear all
        </button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {regions.length === 0 ? "No blur placed yet" : `${regions.length} spot${regions.length === 1 ? "" : "s"} blurred`}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Photo preview. Tap to place a blur over a face or number plate."
        onPointerDown={onCanvasPointer}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const canvas = canvasRef.current;
            if (canvas) addRegionAt(canvas.width / 2, canvas.height / 2);
          }
        }}
        className="mt-3 block max-h-[24rem] w-full cursor-crosshair rounded-md border border-border bg-muted object-contain"
      />

      {note ? <p className="mt-2 text-sm text-amber-700">{note}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => attach(true)}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {regions.length > 0 ? `Attach this photo (${regions.length} spot${regions.length === 1 ? "" : "s"} blurred)` : "Attach this photo"}
        </button>
        <button
          type="button"
          onClick={() => attach(false)}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50"
        >
          Attach without blurring
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-md border border-input px-4 text-sm font-semibold disabled:opacity-50"
        >
          Remove this photo
        </button>
      </div>
    </div>
  );
}

/**
 * Mosaic one region, in place, using the canvas itself as the source: draw the
 * region into a tiny offscreen canvas (÷8) with smoothing off, then draw it
 * back scaled up. A 1/8 downsample is comfortably beyond recognition for faces
 * and plates at phone-photo resolutions, with zero dependencies and no filter
 * API requirements — it works on the browsers rural Jharkhand actually runs.
 */
function pixelate(ctx: CanvasRenderingContext2D, region: Region): void {
  const { x, y, r } = region;
  const side = r * 2;
  const tiny = Math.max(2, Math.round(side / 8));

  const off = document.createElement("canvas");
  off.width = tiny;
  off.height = tiny;
  const octx = off.getContext("2d");
  if (!octx) return;

  octx.imageSmoothingEnabled = false;
  octx.drawImage(ctx.canvas, x - r, y - r, side, side, 0, 0, tiny, tiny);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, tiny, tiny, x - r, y - r, side, side);
  ctx.imageSmoothingEnabled = true;

  // A thin outline so the citizen can see what is covered before attaching.
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(2, r / 24);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
