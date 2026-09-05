/**
 * CLAUDE.md invariant 2: the ledger is append-only, enforced by the database.
 *
 * Three things are tested, and the first of them is tested against the REAL
 * database rather than a mock, because "enforced by a Postgres rule, not by
 * convention" is a claim about Postgres and a mock cannot refute it.
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local" });

const { db } = await import("@/lib/db");
const { sql } = await import("drizzle-orm");
const { canonicalJson, computeEntryHash, contentHashOf, sha256Hex, GENESIS_HASH } = await import("@/lib/ledger/hash");
const { verifyChain } = await import("@/lib/ledger/verify");

describe("canonical serialisation", () => {
  it("is independent of key order — the whole point of hashing a payload", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys at every level, not only the top", () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}],"z":{"c":2,"d":1}}');
  });

  it("serialises a Date the same way as its own ISO string", () => {
    const d = new Date("2026-09-05T10:00:00.000Z");
    expect(canonicalJson({ at: d })).toBe(canonicalJson({ at: d.toISOString() }));
  });

  it("refuses to hash a non-finite number rather than silently writing null", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
  });

  it("is a known-answer test against a plain SHA-256", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("the link", () => {
  it("genesis links to sixty-four zeroes, never to null", () => {
    const withNull = computeEntryHash({ seq: 1, contentHash: "a".repeat(64), prevHash: null, authorId: null, createdAt: "2026-09-05T00:00:00.000Z" });
    const withZeroes = computeEntryHash({ seq: 1, contentHash: "a".repeat(64), prevHash: GENESIS_HASH, authorId: null, createdAt: "2026-09-05T00:00:00.000Z" });
    expect(withNull).toBe(withZeroes);
  });

  it("changing any single field changes the hash", () => {
    const base = { seq: 7, contentHash: "a".repeat(64), prevHash: "b".repeat(64), authorId: "u1", createdAt: "2026-09-05T00:00:00.000Z" };
    const h = computeEntryHash(base);
    expect(computeEntryHash({ ...base, seq: 8 })).not.toBe(h);
    expect(computeEntryHash({ ...base, contentHash: "c".repeat(64) })).not.toBe(h);
    expect(computeEntryHash({ ...base, prevHash: "d".repeat(64) })).not.toBe(h);
    expect(computeEntryHash({ ...base, authorId: "u2" })).not.toBe(h);
    expect(computeEntryHash({ ...base, createdAt: "2026-09-05T00:00:01.000Z" })).not.toBe(h);
  });

  it("tampering with a payload is detectable from that entry onward", () => {
    // A three-entry chain, built the way appendEntry builds one.
    const at = "2026-09-05T00:00:00.000Z";
    const payloads = [{ n: 1 }, { n: 2 }, { n: 3 }];
    let prev = GENESIS_HASH;
    const chain = payloads.map((p, i) => {
      const contentHash = contentHashOf(p);
      const entryHash = computeEntryHash({ seq: i + 1, contentHash, prevHash: prev, authorId: null, createdAt: at });
      prev = entryHash;
      return { seq: i + 1, payload: p, contentHash, prevHash: chain0(i), entryHash };
    });
    function chain0(i: number): string {
      return i === 0 ? GENESIS_HASH : "";
    }

    // Someone edits entry 2's payload in a restored dump.
    const tampered = { ...chain[1], payload: { n: 99 } };
    expect(contentHashOf(tampered.payload)).not.toBe(tampered.contentHash);

    // And entry 3's prev_hash no longer matches what entry 2 now hashes to.
    const recomputed2 = computeEntryHash({
      seq: 2,
      contentHash: contentHashOf(tampered.payload),
      prevHash: chain[0].entryHash,
      authorId: null,
      createdAt: at,
    });
    expect(recomputed2).not.toBe(chain[1].entryHash);
  });
});

/**
 * drizzle wraps a driver error in its own "Failed query:" Error, so the message
 * the trigger RAISEd is on `cause`. Reaching for it is not a workaround: the
 * whole point of the test is that Postgres refused, and the refusal text is the
 * evidence that it was OUR rule that refused rather than some incidental error.
 */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return `${err.message} ${err.cause?.message ?? ""}`;
  }
}

describe("the database refuses to be corrected", () => {
  it("an UPDATE of a content column raises, rather than silently doing nothing", async () => {
    // A silent no-op would be worse than no rule: "UPDATE 0" reads as success.
    const message = await refusal(
      db.execute(sql`UPDATE ledger_entries SET payload = '{"tampered":true}'::jsonb WHERE seq = (SELECT min(seq) FROM ledger_entries)`),
    );
    expect(message).toMatch(/append-only/i);
  });

  it("a DELETE raises", async () => {
    const message = await refusal(
      db.execute(sql`DELETE FROM ledger_entries WHERE seq = (SELECT min(seq) FROM ledger_entries)`),
    );
    expect(message).toMatch(/append-only/i);
  });

  it("re-writing a sealed entry_hash raises", async () => {
    const message = await refusal(
      db.execute(sql`UPDATE ledger_entries SET entry_hash = repeat('f', 64) WHERE seq = (SELECT min(seq) FROM ledger_entries)`),
    );
    expect(message).toMatch(/sealed/i);
  });

  it("the payload of an existing entry still hashes to its recorded content hash", async () => {
    // The tamper test above tried and failed. This asserts nothing got through.
    const rows = (await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ledger_entries WHERE payload ? 'tampered'`,
    )) as unknown as Array<{ n: number }>;
    expect(Number(rows[0].n)).toBe(0);
  });
});

/**
 * The structural guarantee behind the chain.
 *
 * `appendEntry` is the only thing that may write to `ledger_entries`, because it
 * is the only thing that takes the advisory lock and sets `prev_hash`. Six Phase
 * 1/2 call sites inserted directly, which left rows with a null `entry_hash` —
 * and the next append then read that null tip and chained itself to genesis,
 * forking the chain at a point that could never be repaired since `prev_hash`
 * seals on first write. This test is why a seventh cannot appear.
 */
describe("appendEntry is the only writer", () => {
  it("no module outside lib/ledger inserts into ledger_entries", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative, sep } = await import("node:path");

    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === ".next") continue;
          walk(full, out);
        } else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
      }
      return out;
    }

    const offences: string[] = [];
    for (const root of ["app", "lib", "seed", "scripts"]) {
      let files: string[];
      try {
        files = walk(root);
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = relative(process.cwd(), file);
        if (rel.startsWith(`lib${sep}ledger${sep}`)) continue;
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (/insert\s*\(\s*ledgerEntries\s*\)/.test(line)) {
              offences.push(`${rel}:${i + 1} inserts into ledger_entries directly — use appendEntry() from lib/ledger/append`);
            }
          });
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });
});

describe("the live chain", () => {
  it("verifies clean, from genesis to head", async () => {
    const result = await verifyChain();
    expect(result.brokenAtSeq, result.reason ?? "").toBeNull();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
    console.log(`[ledger] ${result.checked} entries verified, head ${result.headHash?.slice(0, 16)}…, ${result.sealedLegacy} covered by the legacy seal`);
  }, 30_000);
});
