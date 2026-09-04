import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Photo handling for citizen evidence.
 *
 * Two things happen before an image is ever stored:
 *
 *  1. **EXIF is stripped, including GPS.** A photo of a cracked embankment
 *     carries the exact coordinates of the person who took it. The location the
 *     citizen chose to share is in `challenges.lat/lng`; the location their
 *     camera recorded is not ours to keep. sharp re-encodes without a metadata
 *     block, which removes EXIF, XMP and IPTC together.
 *  2. **The object key is the SHA-256 of the stored bytes.** The same photo
 *     uploaded twice is one object, and a ledger entry can cite it by hash.
 *
 * Face and number-plate blurring is NOT implemented in this cut. The UI says so
 * to the citizen, `challenge_media.faces_blurred` records the truth, and it is
 * on the declared-stubs slide.
 */

export const MAX_FILES = 3;
export const MAX_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export interface ProcessedImage {
  bytes: Buffer;
  contentHash: string;
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
  exifStripped: boolean;
}

export class MediaRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaRejectedError";
  }
}

/** Re-encode to JPEG with no metadata, then key the result by its own hash. */
export async function processImage(input: Buffer, declaredMime: string): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new MediaRejectedError("That file was empty.");
  if (input.byteLength > MAX_BYTES) {
    throw new MediaRejectedError(`That image is larger than ${MAX_BYTES / 1024 / 1024}MB.`);
  }
  if (!ALLOWED_MIME.includes(declaredMime)) {
    throw new MediaRejectedError("Please upload a JPEG, PNG or WebP photo.");
  }

  const meta = await sharp(input, { failOn: "error" })
    .metadata()
    .catch(() => {
      throw new MediaRejectedError("That file could not be read as an image.");
    });

  // Not calling .withMetadata() is what drops EXIF: sharp only carries metadata
  // across when asked to. Resizing also caps what a 3G upload has to carry.
  const bytes = await sharp(input, { failOn: "error" })
    .rotate() // apply the EXIF orientation before we discard the EXIF
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const contentHash = createHash("sha256").update(bytes).digest("hex");

  return {
    bytes,
    contentHash,
    storageKey: `${contentHash}.jpg`,
    mime: "image/jpeg",
    width: meta.width ?? null,
    height: meta.height ?? null,
    exifStripped: true,
  };
}

/** True when the processed bytes carry no EXIF marker. Used by the verification. */
export async function hasExif(bytes: Buffer): Promise<boolean> {
  const meta = await sharp(bytes).metadata();
  return Boolean(meta.exif);
}
