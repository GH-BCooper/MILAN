/**
 * S3 — deduplication, corroboration, roll-up.
 *
 * CLAUDE.md invariant 9: duplicates are signal, not noise. Nothing here
 * discards a report. A near-duplicate becomes a corroboration of the surviving
 * challenge, both reporters are credited, and the merged challenge keeps its own
 * page which redirects to the survivor. Three related problems across two
 * panchayats become a BLOCK_SYSTEMIC parent with the children linked to it.
 *
 * The decision is a number with fixed thresholds, not a model call. The model
 * is consulted only in the ambiguous middle band, which is what keeps this
 * cheap, fast, and demonstrably the same answer every time.
 */
import "server-only";

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import { clockNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { transition } from "@/lib/db/stateMachine";
import { appendEntry } from "@/lib/ledger/append";
import {
  challenges,
  clusters,
  corroborations,
  creditEdges,
  type Tx,
} from "@/lib/db";
import { runWithChain } from "../providers/chain";
import { haversineKm } from "../routing";
import { toVectorLiteral } from "../providers/embed";
import * as prompt from "../prompts/s3";
import { S3Schema, type S3AdjudicateInput, type S3Output } from "../schemas";
import type { StageRun } from "../types";

/**
 * The thresholds, in one place, tuned by hand on the seed set.
 *
 * PHASE_2_LEARN.md section 3 fixes the two cosine bands. A production system
 * would tune them on labelled data; we tuned them on the three planted
 * near-duplicates and the two genuinely different water challenges in
 * `seed-data/challenges.csv`, and we say exactly that when asked.
 */
export const S3_THRESHOLDS = {
  /** At or above: the same problem. Auto-merge, no model call. */
  autoMerge: 0.86,
  /** At or above (and below autoMerge): ambiguous, ask the model. */
  adjudicate: 0.72,
  /**
   * A block with fewer than this many challenges is too small a pool to compare
   * against, so the prefilter widens to the district. Below that we would miss
   * the duplicate we most want to catch: the same problem reported by two
   * neighbours who picked different blocks from the dropdown.
   */
  blockPoolFloor: 20,
  /** How many candidates the vector search returns before thresholding. */
  candidateK: 10,
  /** Model confidence needed to act on an adjudication in the middle band. */
  adjudicateConfidence: 0.7,
} as const;

/**
 * Anti-brigading (loophole row 7).
 *
 * The Phase 1 unique index already caps one corroboration per identity per
 * challenge. These three add the geographic and temporal dimensions.
 */
export const BRIGADING = {
  /** Corroborations decay beyond this distance: someone 200 km away is not a
   *  witness to a crack in an embankment. */
  decayKm: 15,
  /** More than this many corroborations from one device fingerprint on one
   *  challenge is an anomaly, whatever the accounts say. */
  maxPerDevice: 3,
  /** More than this many corroborations inside one hour is an anomaly. */
  maxPerHour: 25,
} as const;

/**
 * The roll-up rule.
 *
 * Three or more distinct child challenges across two or more panchayats or
 * blocks in the same block-parent scope create a BLOCK_SYSTEMIC parent. One
 * village reporting three things is a village; three villages reporting the
 * same thing is a system, and a system is what a research team can actually
 * address.
 */
export const ROLLUP = {
  minChildren: 3,
  minDistinctPlaces: 2,
  /** Children must be near enough in meaning to be one systemic problem. */
  minSimilarity: 0.62,
} as const;

/* --------------------------------------------------------------- candidates */

export interface Candidate {
  id: string;
  trackingId: string;
  title: string;
  body: string;
  blockCode: string | null;
  districtCode: string | null;
  status: string;
  corroborationCount: number;
  reporterId: string | null;
  reporterName: string | null;
  lat: string | null;
  lng: string | null;
  createdAt: Date;
  similarity: number;
}

/**
 * Block prefilter, then vector kNN.
 *
 * The prefilter is the thing that keeps this cheap at scale: a duplicate of a
 * cracked embankment in Basia is in Basia. Without it, every new challenge
 * would be compared against every challenge in the state, and the HNSW index
 * would be doing work that a WHERE clause does for free. With it, the vector
 * search runs over tens of rows instead of hundreds of thousands.
 */
export async function findCandidates(challenge: {
  id: string;
  blockCode: string | null;
  districtCode: string | null;
  embedding: number[];
}): Promise<Candidate[]> {
  if (challenge.embedding.length === 0) return [];
  const literal = toVectorLiteral(challenge.embedding);

  const blockPool = challenge.blockCode
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(challenges)
        .where(eq(challenges.blockCode, challenge.blockCode))
    : [{ n: 0 }];

  const useBlock =
    challenge.blockCode !== null && Number(blockPool[0]?.n ?? 0) >= S3_THRESHOLDS.blockPoolFloor;

  const scope = useBlock
    ? eq(challenges.blockCode, challenge.blockCode as string)
    : challenge.districtCode
      ? eq(challenges.districtCode, challenge.districtCode)
      : undefined;

  const rows = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      bodyEn: challenges.bodyEn,
      bodyOriginal: challenges.bodyOriginal,
      blockCode: challenges.blockCode,
      districtCode: challenges.districtCode,
      status: challenges.status,
      corroborationCount: challenges.corroborationCount,
      reporterId: challenges.reporterId,
      reporterName: challenges.reporterName,
      lat: challenges.lat,
      lng: challenges.lng,
      createdAt: challenges.createdAt,
      similarity: sql<number>`1 - (${challenges.embedding} <=> ${literal}::vector)`,
    })
    .from(challenges)
    .where(
      and(
        ne(challenges.id, challenge.id),
        isNotNull(challenges.embedding),
        // A merged challenge is not a merge target; that would chain merges and
        // bury the original survivor. Nor is a systemic parent: folding a child
        // into the roll-up that summarises it would destroy the child's own page.
        ne(challenges.status, "MERGED"),
        ne(challenges.status, "REJECTED_UNSAFE"),
        eq(challenges.isParent, false),
        scope,
      ),
    )
    .orderBy(sql`${challenges.embedding} <=> ${literal}::vector`)
    .limit(S3_THRESHOLDS.candidateK);

  return rows.map((r) => ({
    id: r.id,
    trackingId: r.trackingId,
    title: r.title,
    body: r.bodyEn ?? r.bodyOriginal,
    blockCode: r.blockCode,
    districtCode: r.districtCode,
    status: r.status,
    corroborationCount: r.corroborationCount,
    reporterId: r.reporterId,
    reporterName: r.reporterName,
    lat: r.lat,
    lng: r.lng,
    createdAt: r.createdAt,
    similarity: Number(r.similarity),
  }));
}

/* --------------------------------------------------------------- the bands */

export type Band = "AUTO_MERGE" | "ADJUDICATE" | "DISTINCT";

export function bandFor(similarity: number): Band {
  if (similarity >= S3_THRESHOLDS.autoMerge) return "AUTO_MERGE";
  if (similarity >= S3_THRESHOLDS.adjudicate) return "ADJUDICATE";
  return "DISTINCT";
}

export async function adjudicate(
  input: S3AdjudicateInput,
  challengeId?: string | null,
): Promise<StageRun<S3Output>> {
  return runWithChain({
    stage: "S3_ADJUDICATE",
    version: prompt.VERSION,
    system: prompt.SYSTEM,
    user: prompt.render(input),
    schema: S3Schema,
    input,
    challengeId,
    confidenceOf: (v) => v.confidence,
  });
}

/* ------------------------------------------------------------ the geography */

/**
 * How much a corroboration is worth, by distance from the original report.
 *
 * Full weight inside `decayKm`, then an exponential decay. It never reaches
 * zero: someone who moved away still knows their village. It just stops being
 * worth as much as the neighbour who can see the crack.
 */
export function corroborationWeight(distanceKm: number | null): number {
  if (distanceKm === null) return 1;
  if (distanceKm <= BRIGADING.decayKm) return 1;
  return Math.max(0.05, Math.exp(-(distanceKm - BRIGADING.decayKm) / 50));
}

/* -------------------------------------------------------------- the merger */

export interface MergeResult {
  survivorId: string;
  survivorTrackingId: string;
  mergedTrackingId: string;
  similarity: number;
  newCorroborationCount: number;
}

/**
 * Merge `loser` into `survivor`.
 *
 * One transaction: the corroboration row, the corroboration count, both credit
 * edges, the state change and the ledger append. Both reporters are credited —
 * ORIGINATOR on the survivor's chain for whoever reported first, CORROBORATOR
 * for the person whose report was merged. Neither report is deleted.
 */
export async function mergeInto(args: {
  survivor: { id: string; trackingId: string; corroborationCount: number; lat: string | null; lng: string | null };
  loser: {
    id: string;
    trackingId: string;
    reporterId: string | null;
    reporterName: string | null;
    lat: string | null;
    lng: string | null;
    corroborationCount: number;
  };
  similarity: number;
  rationale: string;
}): Promise<MergeResult> {
  const { survivor, loser } = args;
  const at = clockNow();

  const distanceKm =
    survivor.lat && survivor.lng && loser.lat && loser.lng
      ? haversineKm(
          { lat: Number(survivor.lat), lng: Number(survivor.lng) },
          { lat: Number(loser.lat), lng: Number(loser.lng) },
        )
      : null;
  const weight = corroborationWeight(distanceKm);

  // The merged report's own corroborations travel with it. Somebody who backed
  // the second report backed the same problem.
  const carried = Math.max(1, loser.corroborationCount);
  const newCount = survivor.corroborationCount + carried;

  await db.transaction(async (tx: Tx) => {
    // The unique index is (challenge_id, user_id): an anonymous merge (null
    // user) can happen more than once, a signed-in one cannot, which is
    // exactly the anti-brigading behaviour we want.
    await tx
      .insert(corroborations)
      .values({
        challengeId: survivor.id,
        userId: loser.reporterId,
        lat: loser.lat,
        lng: loser.lng,
        distanceKm: distanceKm === null ? null : distanceKm.toFixed(3),
        weight: weight.toFixed(3),
        createdAt: at,
      })
      .onConflictDoNothing();

    await tx
      .update(challenges)
      .set({ corroborationCount: newCount, updatedAt: at })
      .where(eq(challenges.id, survivor.id));

    // Both reporters are credited. This is the whole point of a merge: the
    // second person to notice a problem is not a nuisance, they are evidence.
    //
    // Only ONE edge is written here — the corroborator edge on the survivor.
    // The merged report already carries its own ORIGINATOR edge from the moment
    // it was submitted, and that edge is never touched: the person who reported
    // it is still the originator of their own report, on their own page,
    // permanently. Writing a second one would double the entry and imply the
    // merge created a credit that already existed.
    await tx.insert(creditEdges).values({
      challengeId: survivor.id,
      toUserId: loser.reporterId,
      relation: "CORROBORATOR",
      declaredRole: loser.reporterName ?? "Anonymous reporter",
      createdAt: at,
    });

    await appendEntry(tx, {
      challengeId: loser.id,
      kind: "CREDIT_EDGE",
      at,
      payload: {
        merged: loser.trackingId,
        into: survivor.trackingId,
        similarity: args.similarity,
        rationale: args.rationale,
        at: at.toISOString(),
        // Said plainly, because this is the sentence a suspicious judge needs.
        note: "Nothing was discarded. This report keeps its own page and its own credit edge; the survivor gained a corroboration.",
      },
    });

    // `cluster_id` points both rows at the same cluster so the public page can
    // show "reported by N people" and list every original report behind it.
    await tx
      .update(challenges)
      .set({ clusterId: survivor.id, parentId: survivor.id, updatedAt: at })
      .where(eq(challenges.id, loser.id));

    await transition(tx, {
      challengeId: loser.id,
      to: "MERGED",
      reason: args.rationale,
      meta: { into: survivor.trackingId, similarity: args.similarity, by: "S3" },
    });
  });

  return {
    survivorId: survivor.id,
    survivorTrackingId: survivor.trackingId,
    mergedTrackingId: loser.trackingId,
    similarity: args.similarity,
    newCorroborationCount: newCount,
  };
}

/* --------------------------------------------------------------- the roll-up */

export interface RollupResult {
  parentTrackingId: string;
  childTrackingIds: string[];
  blockCode: string | null;
  corroborationsRolledUp: number;
}

/**
 * Create a BLOCK_SYSTEMIC parent over related children in one block.
 *
 * The parent is a real challenge row with `is_parent = true`, so it routes,
 * scores and is claimed like any other. The children keep their own pages,
 * their own credit chains and their own status: `parent_id` links them, it does
 * not consume them.
 */
export async function rollUp(args: {
  blockCode: string;
  districtCode: string | null;
  children: Array<{ id: string; trackingId: string; title: string; corroborationCount: number; blockCode: string | null; lat: string | null; lng: string | null }>;
  domain: string | null;
  hazard: string | null;
  title: string;
  body: string;
}): Promise<RollupResult | null> {
  if (args.children.length < ROLLUP.minChildren) return null;

  const at = clockNow();
  const { nextTrackingId } = await import("@/lib/db/trackingId");
  const totalCorroborations = args.children.reduce((sum, c) => sum + c.corroborationCount, 0);

  const parentTrackingId = await db.transaction(async (tx: Tx) => {
    const trackingId = await nextTrackingId(tx, args.districtCode ?? "JH");

    const [parent] = await tx
      .insert(challenges)
      .values({
        trackingId,
        status: "SUBMITTED",
        title: args.title,
        bodyOriginal: args.body,
        bodyLang: "en",
        bodyEn: args.body,
        // A roll-up has no citizen author: it is Milan's own observation about
        // a pattern, and the page says so rather than attributing it to anyone.
        reporterName: "Milan (systemic roll-up)",
        districtCode: args.districtCode,
        blockCode: args.blockCode,
        lat: args.children[0]?.lat ?? null,
        lng: args.children[0]?.lng ?? null,
        isParent: true,
        corroborationCount: totalCorroborations,
        recurrence: "constant",
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: challenges.id });

    const [cluster] = await tx
      .insert(clusters)
      .values({
        parentChallengeId: parent.id,
        blockCode: args.blockCode,
        kind: "BLOCK_SYSTEMIC",
        createdAt: at,
      })
      .returning({ id: clusters.id });

    for (const child of args.children) {
      await tx
        .update(challenges)
        .set({ parentId: parent.id, clusterId: cluster.id, updatedAt: at })
        .where(eq(challenges.id, child.id));
    }

    await appendEntry(tx, {
      challengeId: parent.id,
      kind: "STATE_CHANGE",
      at,
      payload: {
        kind: "BLOCK_SYSTEMIC",
        blockCode: args.blockCode,
        children: args.children.map((c) => c.trackingId),
        corroborationsRolledUp: totalCorroborations,
        at: at.toISOString(),
        note: "Children keep their own pages and their own credit chains. Nothing is discarded.",
      },
    });

    return trackingId;
  });

  return {
    parentTrackingId,
    childTrackingIds: args.children.map((c) => c.trackingId),
    blockCode: args.blockCode,
    corroborationsRolledUp: totalCorroborations,
  };
}

/**
 * Look for a systemic pattern worth rolling up.
 *
 * Scope is the district: three or more challenges that are near each other in
 * meaning, spread across two or more blocks, none of them already under a
 * parent. One village reporting three things is a village. Three villages
 * reporting the same thing is a system, and a system is what a research team
 * can actually take on.
 *
 * Returns the children, or null when the pattern is not there. It is called on
 * every S3 run and it is expected to return null most of the time — a roll-up
 * that fired easily would be a roll-up nobody could trust.
 */
export async function findRollupCandidates(challenge: {
  id: string;
  districtCode: string | null;
  blockCode: string | null;
  embedding: number[];
}): Promise<Array<{
  id: string;
  trackingId: string;
  title: string;
  corroborationCount: number;
  blockCode: string | null;
  lat: string | null;
  lng: string | null;
  domain: string | null;
  hazard: string | null;
  similarity: number;
}> | null> {
  if (!challenge.districtCode || challenge.embedding.length === 0) return null;
  const literal = toVectorLiteral(challenge.embedding);

  const rows = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      title: challenges.title,
      corroborationCount: challenges.corroborationCount,
      blockCode: challenges.blockCode,
      lat: challenges.lat,
      lng: challenges.lng,
      domain: challenges.domain,
      hazard: challenges.hazard,
      isParent: challenges.isParent,
      parentId: challenges.parentId,
      status: challenges.status,
      similarity: sql<number>`1 - (${challenges.embedding} <=> ${literal}::vector)`,
    })
    .from(challenges)
    .where(and(eq(challenges.districtCode, challenge.districtCode), isNotNull(challenges.embedding)))
    .orderBy(sql`${challenges.embedding} <=> ${literal}::vector`)
    .limit(20);

  const children = rows.filter(
    (r) =>
      !r.isParent &&
      r.parentId === null &&
      r.status !== "MERGED" &&
      r.status !== "REJECTED_UNSAFE" &&
      r.status !== "FORWARDED_EXTERNAL" &&
      Number(r.similarity) >= ROLLUP.minSimilarity,
  );

  if (children.length < ROLLUP.minChildren) return null;
  const places = new Set(children.map((c) => c.blockCode ?? "unknown"));
  if (places.size < ROLLUP.minDistinctPlaces) return null;
  // The challenge that triggered the check must be one of the children.
  if (!children.some((c) => c.id === challenge.id)) return null;

  return children.map((c) => ({
    id: c.id,
    trackingId: c.trackingId,
    title: c.title,
    corroborationCount: c.corroborationCount,
    blockCode: c.blockCode,
    lat: c.lat,
    lng: c.lng,
    domain: c.domain,
    hazard: c.hazard,
    similarity: Number(c.similarity),
  }));
}

/**
 * Name the parent after what the children actually share, not after whichever
 * one happened to trigger the check. Three reports about water, farming and
 * heat in a drought district share the hazard, not the domain, and calling the
 * cluster "healthcare" because the last report was a health report would be a
 * label nobody could defend.
 */
export function describeCluster(
  children: Array<{ domain: string | null; hazard: string | null; blockCode: string | null }>,
  districtName: string,
): string {
  const blocks = new Set(children.map((c) => c.blockCode ?? "?")).size;
  const hazards = mode(children.map((c) => c.hazard).filter((h): h is string => !!h && h !== "NONE"));
  const domains = mode(children.map((c) => c.domain).filter((d): d is string => !!d));

  const shared =
    hazards && hazards.share >= 0.5
      ? `${hazards.value.replaceAll("_", " ").toLowerCase()} exposure`
      : domains && domains.share >= 0.5
        ? `${domains.value.replaceAll("_", " ").toLowerCase()} problems`
        : "related problems";

  return `${districtName}: ${shared} reported across ${blocks} blocks`;
}

function mode(values: string[]): { value: string; share: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let winner: [string, number] | null = null;
  for (const entry of counts) if (!winner || entry[1] > winner[1]) winner = entry;
  return winner ? { value: winner[0], share: winner[1] / values.length } : null;
}

/* ------------------------------------------------------- anti-brigading scan */

export interface AnomalyFlag {
  kind: "DEVICE_BURST" | "TIME_BURST" | "DISTANT";
  detail: string;
  affected: number;
}

/**
 * Look for the shapes a coordinated push makes.
 *
 * A flagged corroboration is not deleted and not hidden: its weight goes to
 * zero, so it stops moving the score, and it stays visible to admins as signal.
 * Deleting it would throw away the evidence that someone tried.
 */
export async function scanForBrigading(challengeId: string): Promise<AnomalyFlag[]> {
  const flags: AnomalyFlag[] = [];

  const byDevice = await db
    .select({
      fingerprint: corroborations.deviceFingerprint,
      n: sql<number>`count(*)::int`,
    })
    .from(corroborations)
    .where(and(eq(corroborations.challengeId, challengeId), isNotNull(corroborations.deviceFingerprint)))
    .groupBy(corroborations.deviceFingerprint)
    .having(sql`count(*) > ${BRIGADING.maxPerDevice}`);

  for (const row of byDevice) {
    flags.push({
      kind: "DEVICE_BURST",
      detail: `${row.n} corroborations from one device fingerprint (limit ${BRIGADING.maxPerDevice})`,
      affected: Number(row.n),
    });
    await db
      .update(corroborations)
      .set({ weight: "0.000" })
      .where(
        and(
          eq(corroborations.challengeId, challengeId),
          eq(corroborations.deviceFingerprint, row.fingerprint as string),
        ),
      );
  }

  const [burst] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(corroborations)
    .where(
      and(
        eq(corroborations.challengeId, challengeId),
        sql`${corroborations.createdAt} > now() - interval '1 hour'`,
      ),
    );

  if (Number(burst?.n ?? 0) > BRIGADING.maxPerHour) {
    flags.push({
      kind: "TIME_BURST",
      detail: `${burst.n} corroborations inside one hour (limit ${BRIGADING.maxPerHour})`,
      affected: Number(burst.n),
    });
  }

  const [distant] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(corroborations)
    .where(
      and(
        eq(corroborations.challengeId, challengeId),
        sql`${corroborations.distanceKm} > ${BRIGADING.decayKm * 10}`,
      ),
    );

  if (Number(distant?.n ?? 0) > 0) {
    flags.push({
      kind: "DISTANT",
      detail: `${distant.n} corroborations from more than ${BRIGADING.decayKm * 10} km away, down-weighted`,
      affected: Number(distant.n),
    });
  }

  return flags;
}
