/**
 * Task 4.2 regression: the pipeline must complete on a database without
 * pgvector.
 *
 * Root cause it pins: the embedded Postgres the sandbox seeds cannot install
 * the `vector` extension (migration 0000 asks for it), so every `<=>` query
 * died with `type "vector" does not exist`, and S2/S3 were swallowed into
 * "degraded" by the per-stage try/catch — SQL text leaked onto the citizen
 * page included. The fix keeps `<=>` where it exists and ranks by the same
 * cosine in-process where it does not.
 *
 * Why there is no full runPipeline-to-done test here: the pipeline walks the
 * state machine and appends to the ledger, and ledger rows cannot be rolled
 * back (migration 0002 makes that a hard database rule, not a preference).
 * A commit-leaking suite is worse than no suite; the end-to-end assertion
 * lives in scripts/verify-pipeline.mts and the phase-4 acceptance re-shoot.
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local" });

const { hashedEmbedding } = await import("@/lib/ai/providers/embed");
const {
  jsCosineRank,
  parseEmbedding,
  resetVectorSupportCacheForTests,
  supportsVector,
} = await import("@/lib/ai/vector-candidates");
const { knnPrior } = await import("@/lib/ai/stages/s2");
const { findCandidates } = await import("@/lib/ai/stages/s3");
const { db, sql: rawSql } = await import("@/lib/db");
const { challenges } = await import("@/lib/db/schema");

describe("parseEmbedding", () => {
  it("parses the text form both vector and text columns return", () => {
    expect(parseEmbedding("[0.1,-0.2,0.3]")).toEqual([0.1, -0.2, 0.3]);
    expect(parseEmbedding([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("rejects junk instead of throwing into a stage", () => {
    expect(parseEmbedding("not an embedding")).toBeNull();
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding(42)).toBeNull();
    expect(parseEmbedding(["0.1", "0.2"])).toBeNull();
  });
});

describe("jsCosineRank", () => {
  const rows = [
    { id: "a", embedding: "[1,0,0]" },
    { id: "b", embedding: "[0,1,0]" },
    { id: "c", embedding: "garbage" },
    { id: "d", embedding: [0.9, 0.1, 0] },
    { id: "e", embedding: "[1,0]" }, // dimension mismatch: skipped like a NULL
  ];

  it("orders by cosine descending and attaches the score", () => {
    const ranked = jsCosineRank(rows, [1, 0, 0], 10);
    expect(ranked.map((r) => r.id)).toEqual(["a", "d", "b"]);
    expect(ranked[0]!.similarity).toBeCloseTo(1, 6);
    expect(ranked[1]!.similarity).toBeGreaterThan(ranked[2]!.similarity);
  });

  it("caps at k and tolerates an empty query vector", () => {
    expect(jsCosineRank(rows, [1, 0, 0], 1).map((r) => r.id)).toEqual(["a"]);
    expect(jsCosineRank(rows, [], 10)).toEqual([]);
  });
});

describe("vector support probe", () => {
  it("answers consistently within the process", async () => {
    resetVectorSupportCacheForTests();
    const first = await supportsVector(rawSql);
    expect(await supportsVector(rawSql)).toBe(first);
  });
});

describe("candidate queries without pgvector (the 4.2 failure mode)", () => {
  it("knnPrior returns neighbours instead of dying on `<=>`", async () => {
    const priors = await knnPrior(hashedEmbedding("embankment cracked above the village"), null);
    expect(Array.isArray(priors)).toBe(true);
    for (const p of priors) {
      expect(typeof p.domain).toBe("string");
      expect(typeof p.title).toBe("string");
      expect(p.similarity).toBeGreaterThanOrEqual(-1);
      expect(p.similarity).toBeLessThanOrEqual(1);
    }
  });

  it("findCandidates returns ranked, coherently-scored rows", async () => {
    const [anyChallenge] = await db
      .select({ id: challenges.id, blockCode: challenges.blockCode, districtCode: challenges.districtCode })
      .from(challenges)
      .limit(1);
    expect(anyChallenge).toBeDefined();

    const candidates = await findCandidates({
      id: anyChallenge!.id,
      blockCode: anyChallenge!.blockCode,
      districtCode: anyChallenge!.districtCode,
      embedding: hashedEmbedding("flood water enters the fields every monsoon"),
    });
    expect(Array.isArray(candidates)).toBe(true);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.similarity).toBeGreaterThanOrEqual(candidates[i]!.similarity);
    }
    for (const c of candidates) {
      expect(c.id).not.toBe(anyChallenge!.id);
      expect(c.similarity).toBeGreaterThanOrEqual(-1);
      expect(c.similarity).toBeLessThanOrEqual(1);
    }
  });
});
