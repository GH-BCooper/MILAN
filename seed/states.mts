/**
 * Multi-state seed pack (Phase 4, Task 4.5).
 *
 * Walks a handful of seeded challenges forward through the real state machine
 * — never by writing a status column directly — so the demo boards stop
 * reading like a flat list of SUBMITTED rows. Ledger entries, SLA deadlines,
 * credit edges, notifications and outbox rows all exist because the same
 * functions the UI uses wrote them: `releaseGate`, `claimAs`,
 * `publishArtifact`, `markImplemented`, `confirmImpact`, and the SLA reaper.
 *
 * The cast is deliberate:
 *
 *   ROUTED ×3 ................ PAK-0001, RAN-0001, SAH-0001  (fills /hei/inbox)
 *   ROUTED ×1 ................ GUM-0002 (verify:gov's ladder target — a Gumla
 *                              challenge must be sitting ROUTED with unfired
 *                              WIDEN/OPEN_ALL/BREACH deadlines; its rungs are
 *                              shielded +120d so verify:sla's +45d walk and the
 *                              demo's +21d fast-forward cannot consume them —
 *                              verify:gov jumps to each rung's own due date)
 *   IN_RESEARCH ×1 ........... GUM-0003                     (fills /hei projects)
 *   SOLUTION_PUBLISHED ×1 .... DHN-0001 (+ industry interest, fills /industry/discover)
 *   CITIZEN_VERIFIED ×1 ...... GOD-0001 (via IMPLEMENTED + confirm; moves /stats;
 *                              carries the Foundation EOI so /industry/csr holds a
 *                              CONFIRMED BY CITIZEN row)
 *   BOUNTY_LISTED ×1 ......... LAT-0002 (SLA breach via the reaper, fills /bounties)
 *
 * Everything downstream of a claim claims as the seeded BIT Sindri HOD, the
 * institution the pipeline actually shortlisted. The hero challenge
 * (JH-2026-GUM-0001) is never touched — the demo console's one-click beats
 * still own it, and the runbook releases it live.
 *
 * Idempotent by status: a challenge already at or past its target is skipped
 * with a line in the log, so re-running `pnpm seed:states` after a demo run
 * repairs nothing and breaks nothing.
 *
 * Run: `pnpm seed:states` (after `pnpm seed`).
 */
import { config } from "dotenv";
import { asc, desc, eq, sql as sqlTag } from "drizzle-orm";

/* .env.local before anything that touches process.env — lib/db reads
 * DATABASE_URL once, at module load, so every env-dependent import below is
 * dynamic. */
config({ path: ".env.local" });
config();

import type { ChallengeStatus } from "@/lib/db/schema";

const { db } = await import("@/lib/db");
const {
  auditLog,
  challenges,
  capabilities,
  industryInterests,
  projects,
  routes,
  slaDeadlines,
  userProfiles,
} = await import("@/lib/db/schema");
const { user } = await import("@/lib/db/auth-schema");
const { clockNow } = await import("@/lib/clock");
const { canTransition, transition } = await import("@/lib/db/stateMachine");
const { runReaper } = await import("@/lib/sla/reaper");
const { claimAs } = await import("@/app/(hei)/hei/challenges/[trackingId]/claim/actions");
const { releaseGate } = await import("@/lib/ai/stages/s5");
const { markImplemented } = await import("@/lib/impact/implemented");
const { verifyToken } = await import("@/lib/verify/token");
const { confirmImpact } = await import("@/app/(citizen)/me/verify/[token]/actions");
const { publishArtifact } = await import("@/lib/artifacts/publish");

/* ------------------------------------------------------------------ cast */

/** The DC who signs the releases, and the admin who owns the seed's footsteps. */
const GOV_EMAIL = "dc.gumla@jh.gov.demo.milan.in";
const ADMIN_EMAIL = "admin@milan.demo.milan.in";

const ROUTED_THREE = ["JH-2026-PAK-0001", "JH-2026-RAN-0001", "JH-2026-SAH-0001"];
const RESEARCH_ONE = "JH-2026-GUM-0003";
const PUBLISHED_ONE = "JH-2026-DHN-0001";
const CONFIRMED_ONE = "JH-2026-GOD-0001";
/**
 * Latehar sits in no other role's happy path for this pack, and — this is the
 * selection criterion — none of its three shortlist offers points at BIT
 * Sindri: a Bounty-listed challenge keeps its offers OFFERED, and the HEI
 * inbox would otherwise show the unbreached three plus this one. */
const BREACHED_ONE = "JH-2026-LAT-0002";
/**
 * verify:gov climbs the WIDEN → OPEN_ALL → BREACH ladder on a Gumla challenge,
 * so one must be sitting ROUTED with its deadlines unfired. GUM-0002 — never
 * the demo hero, which the runbook releases live.
 */
const LADDER_TARGET = "JH-2026-GUM-0002";

/* -------------------------------------------------------------- helpers */

function log(message: string) {
  console.log(`[states] ${message}`);
}

/** One legal edge at a time, with a written reason, inside one transaction. */
async function step(
  challengeId: string,
  current: ChallengeStatus,
  to: ChallengeStatus,
  actorId: string | null,
  reason: string,
  projectId: string | null = null,
): Promise<ChallengeStatus> {
  if (current === to) return current;
  if (!canTransition(current, to)) {
    throw new Error(`[states] illegal edge ${current} -> ${to} for ${challengeId}`);
  }
  await db.transaction(async (tx) => {
    await transition(tx, {
      challengeId,
      to,
      actorId,
      projectId,
      lastActivityAt: clockNow(),
      reason,
      meta: { by: "seed-states" },
    });
  });
  return to;
}

/**
 * The human part the rules tier will not do: release the report from intake
 * triage all the way past scoring, one legal edge at a time, with reasons a
 * reviewer would accept. Ends at VERIFIED, one step short of routing, because
 * routing is `releaseGate`'s job.
 */
async function releaseFromIntake(
  trackingId: string,
  challengeId: string,
  status: ChallengeStatus,
  actorId: string,
): Promise<ChallengeStatus> {
  const LADDER: Array<[ChallengeStatus, ChallengeStatus, string]> = [
    ["SUBMITTED", "TRIAGED", "Released from the intake triage queue at seed time; no unsafe content, no grievance to forward."],
    ["TRIAGED", "CLASSIFIED", "Accepted the S2 classification proposal against the seeded review."],
    ["CLASSIFIED", "CLUSTERED", "Deduplication checked against seeded corroboration; no merge."],
    ["CLUSTERED", "PRIORITISED", "Priority score recorded at seed time."],
    ["PRIORITISED", "VERIFIED", "Severity below the human gate; routed without further review."],
  ];
  let current = status;
  for (const [from, to, reason] of LADDER) {
    if (current === from) current = await step(challengeId, current, to, actorId, reason);
  }
  if (current !== "VERIFIED") {
    throw new Error(`[states] ${trackingId}: intake release landed at ${current}, expected VERIFIED`);
  }
  log(`${trackingId}: ${status} → VERIFIED (human intake release, five legal edges).`);
  return current;
}

/** The seeded HEI member of an org, in the exact shape `claimAs` expects. */
async function heiMemberOf(orgId: string) {
  const [member] = await db
    .select({
      id: userProfiles.userId,
      fullName: userProfiles.fullName,
      orgId: userProfiles.orgId,
      districtCode: userProfiles.districtCode,
      blockCode: userProfiles.blockCode,
      role: userProfiles.role,
      preferredLang: userProfiles.preferredLang,
      verifiedTier: userProfiles.verifiedTier,
      orgVerificationStatus: userProfiles.orgVerificationStatus,
      email: user.email,
      name: user.name,
    })
    .from(userProfiles)
    .innerJoin(user, eq(user.id, userProfiles.userId))
    .where(eq(userProfiles.orgId, orgId))
    .limit(1);
  if (!member) throw new Error(`[states] no seeded HEI member for org ${orgId}`);
  return member;
}

/**
 * The claim beat, as the console does it: claim as the HOD of the org the
 * pipeline actually shortlisted, with the citizen credited on the team.
 * Returns the new project's id, or null when the challenge already has one.
 */
async function claimWithShortlist(
  trackingId: string,
  challengeId: string,
  actorId: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.challengeId, challengeId))
    .limit(1);
  if (existing) {
    log(`${trackingId}: already claimed (project exists) — skipping.`);
    return existing.id;
  }

  const offers = await db
    .select({ capabilityId: routes.capabilityId, orgId: routes.orgId })
    .from(routes)
    .where(eq(routes.challengeId, challengeId))
    .orderBy(asc(routes.rank));
  if (offers.length === 0) {
    throw new Error(`[states] ${trackingId}: no shortlist to claim from — run pnpm seed:ai first`);
  }

  /* Claim through the best-ranked offer whose org actually has a seeded HEI
   * member — e.g. GOD-0001 ranks RIMS Ranchi first, but RIMS has no seeded
   * profile, so the claim falls to BIT Sindri's offer further down. */
  let offer: (typeof offers)[number] | null = null;
  let hod: Awaited<ReturnType<typeof heiMemberOf>> | null = null;
  for (const candidate of offers) {
    if (!candidate.capabilityId) continue;
    try {
      const member = await heiMemberOf(candidate.orgId);
      offer = candidate;
      hod = member;
      break;
    } catch {
      continue;
    }
  }
  if (!offer?.capabilityId || !hod) {
    throw new Error(`[states] ${trackingId}: no shortlist offer maps to a seeded HEI member`);
  }

  const [cap] = await db
    .select({ department: capabilities.department })
    .from(capabilities)
    .where(eq(capabilities.id, offer.capabilityId))
    .limit(1);
  const [c] = await db
    .select({ title: challenges.title })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);

  await db.insert(auditLog).values({
    actorId,
    action: "seed.states.claim.as",
    targetType: "user",
    targetId: hod.id,
    reason: "Multi-state seed pack claiming as the seeded head of department.",
    meta: { trackingId, orgId: offer.orgId },
    createdAt: clockNow(),
  });

  const result = await claimAs(hod, {
    trackingId,
    capabilityId: offer.capabilityId,
    title: `${cap?.department ?? "Department"} final-year project: ${(c?.title ?? "").slice(0, 90)}`,
    ipTrack: "OPEN",
    members: [
      { email: "student1@bitsindri.demo.milan.in", name: "Aarti Kumari", declaredRole: "Lead student" },
      { email: "student2@bitsindri.demo.milan.in", name: "Rakesh Mahto", declaredRole: "Instrumentation" },
    ],
    mentorEmail: hod.email,
    mentorName: hod.fullName,
    citizenRole: "Domain Informant",
    creditCitizen: true,
    confirmCapacity: true,
  });
  if (!result.ok) throw new Error(`[states] ${trackingId}: claim refused — ${JSON.stringify(result)}`);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.challengeId, challengeId))
    .limit(1);
  log(`${trackingId}: ROUTED → CLAIMED by ${hod.fullName}; credit edges and ledger rows written.`);
  return project?.id ?? null;
}

/**
 * Walk CLAIMED → PROPOSAL_APPROVED → IN_RESEARCH → SOLUTION_PUBLISHED, or
 * whichever suffix of that ladder remains. Statuses past the target are left
 * untouched (idempotent re-runs), statuses before it step one legal edge at
 * a time with a written reason.
 */
const RESEARCH_LADDER: ChallengeStatus[] = ["CLAIMED", "PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED"];

async function walkPath(
  challengeId: string,
  current: ChallengeStatus,
  target: ChallengeStatus,
  actorId: string,
  projectId: string | null,
  beat: string,
): Promise<ChallengeStatus> {
  const ci = RESEARCH_LADDER.indexOf(current);
  const ti = RESEARCH_LADDER.indexOf(target);
  if (ci < 0 || ti < 0 || ci >= ti) return current;
  let at = current;
  for (let i = ci + 1; i <= ti; i++) {
    at = await step(
      challengeId,
      at,
      RESEARCH_LADDER[i],
      actorId,
      `Seed pack advancing ${beat} to ${RESEARCH_LADDER[i].replaceAll("_", " ").toLowerCase()}.`,
      projectId,
    );
  }
  return at;
}

/**
 * One industry_interests row, exactly the rows `expressInterest` writes (the
 * server action guards on session role; the seed acts as the seeded CSR user
 * and writes the same row through the same table), plus the bell for the
 * project lead. Idempotent per challenge. Returns true when written.
 */
async function recordIndustryEoi(trackingId: string, challengeId: string, message: string): Promise<boolean> {
  const [csr] = await db
    .select({ id: userProfiles.userId, orgId: userProfiles.orgId })
    .from(userProfiles)
    .innerJoin(user, eq(user.id, userProfiles.userId))
    .where(eq(user.email, "csr@tatasteelfoundation.demo.milan.in"))
    .limit(1);
  if (!csr?.orgId) throw new Error("[states] seeded CSR user missing");

  const [existing] = await db
    .select({ id: industryInterests.id })
    .from(industryInterests)
    .where(eq(industryInterests.challengeId, challengeId))
    .limit(1);
  if (existing) return false;

  const { notify } = await import("../lib/notify");
  await db.insert(industryInterests).values({
    challengeId,
    orgId: csr.orgId,
    userId: csr.id,
    message,
    createdAt: clockNow(),
  });
  const [project] = await db
    .select({ leadUserId: projects.leadUserId })
    .from(projects)
    .where(eq(projects.challengeId, challengeId))
    .limit(1);
  if (project?.leadUserId) {
    await notify({
      userId: project.leadUserId,
      kind: "INDUSTRY_INTEREST",
      title: "A firm has expressed interest in your project",
      body: `${trackingId}: a funding offer from the Tata Steel Foundation CSR desk.`,
      actionUrl: `/industry/challenges/${trackingId}`,
      channels: ["inapp", "email"],
    });
  }
  return true;
}

/* ----------------------------------------------------------------- main */

async function main() {
  const [gov] = await db.select({ id: user.id }).from(user).where(eq(user.email, GOV_EMAIL)).limit(1);
  const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.email, ADMIN_EMAIL)).limit(1);
  if (!gov || !admin) throw new Error("[states] seeded demo users missing — run pnpm seed first");

  /* Load the full cast. */
  const cast = await db
    .select({
      id: challenges.id,
      trackingId: challenges.trackingId,
      status: challenges.status,
      title: challenges.title,
      slaBreachedAt: challenges.slaBreachedAt,
      escalationStage: challenges.escalationStage,
    })
    .from(challenges)
    .orderBy(asc(challenges.trackingId));

  const byTracking = new Map(cast.map((c) => [c.trackingId, c]));
  const need = [...ROUTED_THREE, RESEARCH_ONE, PUBLISHED_ONE, CONFIRMED_ONE, BREACHED_ONE, LADDER_TARGET];
  for (const t of need) {
    if (!byTracking.has(t)) throw new Error(`[states] cast member ${t} is not seeded`);
  }

  /* ------------------------------------------------------- 1 / the three */
  log("Walking three challenges to ROUTED via the DC's gate…");
  for (const t of ROUTED_THREE) {
    const c = byTracking.get(t)!;
    if (c.status === "ROUTED") {
      log(`${t}: already ROUTED — skipping.`);
      continue;
    }
    if (c.status !== "SUBMITTED") throw new Error(`[states] ${t}: expected SUBMITTED, found ${c.status}`);
    await releaseFromIntake(t, c.id, c.status, gov.id);
    const released = await releaseGate({
      challengeId: c.id,
      trackingId: c.trackingId,
      actorId: gov.id,
      reason: "Released at the human gate by the seed pack — the DC's countersign.",
    });
    log(`${t}: VERIFIED → ${released.status}; ${released.notified} notification(s) released.`);
  }

  /* --------------------------------------- 1b / one Gumla on the ladder */
  {
    const c = byTracking.get(LADDER_TARGET)!;
    const [fresh] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
    if (fresh.status === "SUBMITTED") {
      await releaseFromIntake(c.trackingId, c.id, fresh.status, gov.id);
      const released = await releaseGate({ challengeId: c.id, trackingId: c.trackingId, actorId: gov.id, reason: "Released at the human gate by the seed pack — verify:gov's ladder target." });
      // The reaper is global and the clock is shared: verify:sla's +45d walk
      // and the demo's +21d fast-forward would fire this target's rungs (due
      // +7/+14d by default) before verify:gov runs. Shift every open deadline
      // +120d — rung spacing intact. verify:gov time-travels to each rung's
      // own due date, so it fires them wherever they sit.
      await db.execute(
        sqlTag`update sla_deadlines set due_at = due_at + make_interval(days => 120)
                where challenge_id = ${c.id} and fired_at is null and cancelled_at is null`,
      );
      log(`${c.trackingId}: VERIFIED → ${released.status}; ${released.notified} notification(s) released; ladder rungs shielded +120d.`);
    } else {
      log(`${c.trackingId}: already ${fresh.status} — skipping.`);
    }
  }

  /* ------------------------------------------------ 2 / one into research */
  {
    const c = byTracking.get(RESEARCH_ONE)!;
    let status = c.status;
    if (status === "SUBMITTED") {
      await releaseFromIntake(c.trackingId, c.id, status, gov.id);
      await releaseGate({ challengeId: c.id, trackingId: c.trackingId, actorId: gov.id, reason: "Released at the human gate by the seed pack." });
      status = "ROUTED";
    }
    const projectId = await claimWithShortlist(c.trackingId, c.id, admin.id);
    if (status === "ROUTED") status = "CLAIMED";
    if (status === "CLAIMED") {
      status = await step(c.id, "CLAIMED", "PROPOSAL_APPROVED", admin.id, "Proposal approved by the mentor at seed time.", projectId);
      log(`${c.trackingId}: CLAIMED → PROPOSAL_APPROVED.`);
    }
    if (status === "PROPOSAL_APPROVED") {
      status = await step(c.id, "PROPOSAL_APPROVED", "IN_RESEARCH", admin.id, "Field work under way; the seed clock keeps the silence ladder honest.", projectId);
      log(`${c.trackingId}: PROPOSAL_APPROVED → IN_RESEARCH.`);
    }
  }

  /* ----------------------------------------- 3 / one published + interest */
  {
    const c = byTracking.get(PUBLISHED_ONE)!;
    let current: ChallengeStatus = "ROUTED";
    const [fresh] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
    if (fresh.status === "SUBMITTED") {
      await releaseFromIntake(c.trackingId, c.id, fresh.status, gov.id);
      await releaseGate({ challengeId: c.id, trackingId: c.trackingId, actorId: gov.id, reason: "Released at the human gate by the seed pack." });
    }
    const projectId = await claimWithShortlist(c.trackingId, c.id, admin.id);
    if (!projectId) throw new Error(`[states] ${c.trackingId}: claim produced no project`);

    const [again] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
    current = again.status;
    await walkPath(c.id, current, "SOLUTION_PUBLISHED", admin.id, projectId, "the publish beat");

    // The artifact makes SOLUTION_PUBLISHED true in the only way that matters:
    // bytes under their own hash, ledger's REPORT entry, public page.
    const alreadyPublished = await db.execute(sqlTag`
      select id from artifacts where project_id = ${projectId} limit 1
    `);
    if (alreadyPublished.length === 0) {
      const result = await publishArtifact({
        projectId,
        kind: "REPORT",
        title: "Mine-fire and subsidence monitoring over the Jharia coalfield: sensor siting and thresholds",
        abstract:
          "A low-cost method for siting thermal and tilt sensors above fire-affected colonies, " +
          "with the temperature-rate thresholds that should trigger a ward-level evacuation advisory. " +
          "Published under CC-BY so any district may reuse it.",
        licence: "CC_BY",
        authorId: admin.id,
        file: { bytes: Buffer.from(`Milan seed artifact for ${c.trackingId}\n`), mime: "application/pdf", name: "report.pdf" },
      });
      log(`${c.trackingId}: artifact published (ledger seq ${result.ledgerSeq}, hash ${result.contentHash.slice(0, 12)}…).`);
    } else {
      log(`${c.trackingId}: artifact already published — skipping.`);
    }

    const ok = await recordIndustryEoi(
      c.trackingId,
      c.id,
      "We would fund a pilot of this monitoring method across two more fire-affected colonies under our section-135 mine-safety programme, if the team is willing to field-validate with our district partner.",
    );
    if (ok) {
      log(`${c.trackingId}: SOLUTION_PUBLISHED with a recorded industry EOI — /industry/discover has its story.`);
    } else {
      log(`${c.trackingId}: industry interest already recorded — skipping.`);
    }
  }

  /* --------------------------------------- 4 / one claimed, one confirmed */
  {
    const c = byTracking.get(CONFIRMED_ONE)!;
    let current: ChallengeStatus = "ROUTED";
    const [fresh] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
    if (fresh.status === "SUBMITTED") {
      await releaseFromIntake(c.trackingId, c.id, fresh.status, gov.id);
      await releaseGate({ challengeId: c.id, trackingId: c.trackingId, actorId: gov.id, reason: "Released at the human gate by the seed pack." });
    }
    const projectId = await claimWithShortlist(c.trackingId, c.id, admin.id);

    current = (await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1))[0].status;
    current = await walkPath(c.id, current, "SOLUTION_PUBLISHED", admin.id, projectId, "the implementation beat");

    if (current !== "CITIZEN_VERIFIED" && current !== "CLOSED") {
      if (canTransition(current, "IMPLEMENTED")) {
        await markImplemented({
          challengeId: c.id,
          actorId: gov.id,
          claim: "Cholera-response protocol implemented in the affected block during the seed walk.",
        });
        current = "IMPLEMENTED";
        log(`${c.trackingId}: IMPLEMENTED — a claim, not an outcome.`);
      }
      if (current === "IMPLEMENTED") {
        const fd = new FormData();
        fd.set("token", verifyToken(c.id));
        fd.set("answer", "YES");
        fd.set("note", "Confirmed by the citizen during the seed walk.");
        const result = await confirmImpact(null, fd);
        log(`${c.trackingId}: ${result.message}`);
        const [after] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
        if (after.status !== "CITIZEN_VERIFIED" && after.status !== "CLOSED") {
          throw new Error(`[states] ${c.trackingId}: confirm did not land (status ${after.status})`);
        }
      }
    } else {
      log(`${c.trackingId}: already ${current} — skipping.`);
    }

    /* The §135 export counts CONFIRMED BY CITIZEN rows off industry_interests
     * joined to confirmed challenges — give the Foundation's support of this
     * confirmed outcome its row, or the CSR page can only show zeros. */
    const funded = await recordIndustryEoi(
      c.trackingId,
      c.id,
      "We supported the implementing team through our district partner's field budget and would fund the next ward cluster under our section-135 rural-infrastructure programme.",
    );
    if (funded) log(`${c.trackingId}: Foundation support recorded — the CSR export now holds a CONFIRMED BY CITIZEN row.`);
  }

  /* ----------------------------------------------------- 5 / one breached */
  {
    const c = byTracking.get(BREACHED_ONE)!;
    if (c.slaBreachedAt) {
      log(`${c.trackingId}: already breached — skipping.`);
    } else {
      const [fresh] = await db.select({ status: challenges.status }).from(challenges).where(eq(challenges.id, c.id)).limit(1);
      if (fresh.status === "SUBMITTED") {
        await releaseFromIntake(c.trackingId, c.id, fresh.status, gov.id);
        await releaseGate({ challengeId: c.id, trackingId: c.trackingId, actorId: gov.id, reason: "Released at the human gate by the seed pack." });
      }
      /**
       * Breach it honestly: only the CLOCK runs backwards. The state machine
       * materialised its four ROUTED deadlines, SLA reaper fires them in due
       * order (WIDEN writes five more offers through the real path, OPEN_ALL
       * flips the flags, BREACH timestamps and lists), and every escalation
       * lands in the ledger with `by: sla-reaper`, exactly as it would on the
       * twenty-first day in production. Nothing handwritten, nothing faked.
       */
      const now = clockNow();

      /* Each escalation tier cancels its old deadlines and schedules fresh
       * ones (WIDEN re-arms OPEN_ALL/BREACH 7/14 days out), so "the clock
       * runs backwards" must be applied, reaper run, reapplied: three rounds
       * of backdate-then-reaper walk ROUTED → UNCLAIMED_ESCALATED →
       * BOUNTY_LISTED through the real machinery. */
      const backdate = async () => {
        const past = new Date(now.getTime() - 15 * 24 * 3600 * 1000).toISOString();
        await db.execute(sqlTag`
          update sla_deadlines set due_at = ${past}
          where challenge_id = ${c.id} and fired_at is null and cancelled_at is null
            and kind in ('WIDEN', 'OPEN_ALL', 'BREACH')
        `);
        await db.execute(sqlTag`
          update challenges set routed_at = coalesce(routed_at, ${new Date(now.getTime() - 22 * 24 * 3600 * 1000).toISOString()})
          where id = ${c.id}
        `);
      };
      for (let pass = 1; pass <= 5; pass++) {
        await backdate();
        const result = await runReaper({ limit: 200 });
        log(`${c.trackingId}: reaper round ${pass} — fired ${result.fired.length}, errors ${result.errors.length}.`);
        if (result.errors.length > 0) throw new Error(`[states] reaper failed: ${JSON.stringify(result.errors[0])}`);
        const [check] = await db
          .select({ breached: challenges.slaBreachedAt })
          .from(challenges)
          .where(eq(challenges.id, c.id))
          .limit(1);
        if (check?.breached) break;
      }
      const [after] = await db
        .select({ status: challenges.status, stage: challenges.escalationStage, breached: challenges.slaBreachedAt })
        .from(challenges)
        .where(eq(challenges.id, c.id))
        .limit(1);
      if (!after.breached) throw new Error(`[states] ${c.trackingId}: reaper ran but no breach landed`);
      log(`${c.trackingId}: ${after.status} at stage ${after.stage} — /bounties has its proof.`);
    }
  }

  /* --------------------------- invariant 1: open a clock on every orphan */
  const orphaned = (await db.execute(sqlTag`
    select c.id, c.tracking_id, c.status::text as status
    from challenges c
    where c.status not in ('CLOSED','MERGED','FORWARDED_EXTERNAL','WITHDRAWN','REJECTED_UNSAFE')
      and not exists (
        select 1 from sla_deadlines d
        where d.challenge_id = c.id and d.fired_at is null and d.cancelled_at is null
      )
    order by c.tracking_id
  `)) as unknown as Array<{ id: string; tracking_id: string; status: string }>;
  if (orphaned.length > 0) {
    /* status moves cancel their stage deadlines; the sanctioned repair
     * (scripts/sla-backfill.mts — the seed calls it, too) re-opens one per
     * orphan. Run the same repair here so the pack never leaves the health
     * strip red. */
    const { deadlinesFor } = await import("@/lib/sla/deadlines");
    const now2 = clockNow();
    let opened = 0;
    for (const orphan of orphaned) {
      const [project] = await db
        .select({ id: projects.id, lastActivityAt: projects.lastActivityAt })
        .from(projects)
        .where(eq(projects.challengeId, orphan.id))
        .limit(1);
      const specs = deadlinesFor(orphan.status as ChallengeStatus, {
        now: now2,
        projectId: project?.id ?? null,
        lastActivityAt: project?.lastActivityAt ?? null,
      });
      if (specs.length === 0) continue;
      await db.insert(slaDeadlines).values(
        specs.map((spec) => ({
          challengeId: orphan.id,
          projectId: spec.projectId ?? project?.id ?? null,
          kind: spec.kind,
          dueAt: spec.dueAt,
          payload: { ...(spec.payload ?? {}), backfilled: true, by: "seed-states" },
          createdAt: now2,
        })),
      );
      opened += specs.length;
    }
    log(`invariant-1 repair: ${orphaned.length} orphan(s), ${opened} deadline(s) opened.`);
  }

  /* ----------------------------------------------------- the story check */
  const funnel = await db
    .select({ status: challenges.status, n: sqlTag<number>`count(*)::int` })
    .from(challenges)
    .groupBy(challenges.status)
    .orderBy(desc(sqlTag`count(*)`));
  const distinct = funnel.length;
  log(`final distribution: ${funnel.map((f) => `${f.status}×${f.n}`).join(" ")}`);
  if (distinct < 5) throw new Error(`[states] only ${distinct} distinct statuses — /stats would be flat`);
  log(`done: ${distinct} distinct statuses on the board.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
