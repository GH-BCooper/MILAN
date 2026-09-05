/**
 * The hashing rules for the provenance chain.
 *
 * Explicitly excluded from the stack, and we say why on the slide: a blockchain.
 * A SHA-256 hash chain plus a public timestamp gives the same non-repudiation at
 * zero cost and zero latency. What it needs to be worth anything is that any
 * third party can recompute a hash and get the same answer — which means the
 * serialisation has to be pinned down here, not left to `JSON.stringify`'s key
 * order happening to be stable.
 *
 * Pure. No I/O, no database, no `server-only` — the browser runs the same code
 * on /ledger, which is the point of the "Verify chain" button.
 */
import { createHash } from "node:crypto";

/**
 * Canonical JSON: keys sorted at every level, no whitespace, `undefined` and
 * function values dropped, numbers written the way JSON.stringify writes them
 * (which for every value we store is exact — we never hash a float that came
 * from arithmetic, only integers, strings and ISO timestamps).
 *
 * Dates are serialised as ISO-8601 UTC. A Date and its own toISOString() hash
 * identically, so a payload read back out of jsonb hashes the same as the one
 * that went in.
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  switch (typeof value) {
    case "number":
      // NaN and Infinity are not representable in JSON, and a hash that silently
      // became "null" would be a hash of the wrong thing.
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(value.toString());
    case "undefined":
    case "function":
    case "symbol":
      return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => stringify(v)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => typeof obj[k] !== "undefined" && typeof obj[k] !== "function")
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(",")}}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The content hash of an entry's payload — what the entry is *about*. */
export function contentHashOf(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

export interface EntryHashInput {
  seq: number;
  contentHash: string;
  /** The genesis entry's predecessor. 64 zeroes, never null, so the input shape never varies. */
  prevHash: string | null;
  authorId: string | null;
  createdAt: Date | string;
}

/** The chain's zero. Genesis links to this rather than to null. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * The link. `entry_hash = sha256(canonical({seq, contentHash, prevHash, authorId, createdAt}))`.
 *
 * Changing any earlier payload changes its content hash, which changes its entry
 * hash, which is the next entry's prev_hash — so verification fails from the
 * tampered entry onward and names the seq. That is the whole mechanism, and it
 * fits in one function on purpose: a judge can read it.
 */
export function computeEntryHash(input: EntryHashInput): string {
  const createdAt = input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt;
  return sha256Hex(
    canonicalJson({
      seq: Number(input.seq),
      contentHash: input.contentHash,
      prevHash: input.prevHash ?? GENESIS_HASH,
      authorId: input.authorId ?? null,
      createdAt,
    }),
  );
}

/** A short hash for a table cell. Never used for comparison, only for display. */
export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : "—";
}
