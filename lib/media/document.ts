import "server-only";

import { createHash } from "node:crypto";

/**
 * Proof-of-affiliation document handling (HEI/Industry registration).
 *
 * Unlike citizen photo evidence (lib/media/upload.ts), a proof document may be
 * a PDF, so it is not re-encoded through sharp — it is stored as-is, keyed by
 * the SHA-256 of its own bytes (same dedup-by-hash convention as the rest of
 * the media pipeline). It is not run through any content moderation; a human
 * admin looks at it directly on /admin/verification before approving anyone.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export interface ProcessedDocument {
  bytes: Buffer;
  contentHash: string;
  storageKey: string;
  mime: string;
}

export class DocumentRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentRejectedError";
  }
}

export function processDocument(input: Buffer, declaredMime: string): ProcessedDocument {
  if (input.byteLength === 0) throw new DocumentRejectedError("That file was empty.");
  if (input.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentRejectedError(`That file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB.`);
  }
  const ext = ALLOWED_DOCUMENT_MIME[declaredMime];
  if (!ext) {
    throw new DocumentRejectedError("Please upload a PDF, JPEG or PNG.");
  }

  const contentHash = createHash("sha256").update(input).digest("hex");
  return {
    bytes: input,
    contentHash,
    storageKey: `org-proofs/${contentHash}.${ext}`,
    mime: declaredMime,
  };
}
