"use server";

/**
 * The judge console's buttons.
 *
 * Every one of these is idempotent and every one of them reports what it
 * actually did, including when it did nothing. On stage, a button that silently
 * no-ops is worse than a button that says "already done" — the driver needs to
 * know which beat they are on without reading the database.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "@/lib/auth/guards";
import { clockNow } from "@/lib/clock";
import { advanceClock, resetClock, syncClockOffset } from "@/lib/clock/server";
import { db } from "@/lib/db";
import { challenges, projects, type ChallengeStatus } from "@/lib/db/schema";
import { canTransition, transition } from "@/lib/db/stateMachine";
import { runReaper, type FiredDeadline } from "@/lib/sla/reaper";
import { elapsedMs } from "@/lib/clock";

export interface DemoResult {
  ok: boolean;
  title: string;
  message: string;
  /** Rendered as a live log on the console — the counterfactual beat at 4:15. */
  fired?: FiredDeadline[];
  ms?: number;
}

/* ------------------------------------------------------- the clock buttons */

const Advance = z.object({ days: z.coerce.number().int().min(-3650).max(3650) });

/**
 * Advance, then reap immediately, then show every ladder action that fired.
 *
 * The two are one button on purpose. A judge pressing "+21 days" and then
 * having to press "run the reaper" would be watching an implementation detail;
 * what they should watch is a challenge escalating in public because a clock
 * ran out.
 */
export async function advanceAndReap(_prev: DemoResult | null, form: FormData): Promise<DemoResult> {
  const user = await requireRole("ADMIN");
  const parsed = Advance.safeParse({ days: form.get("days") });
  if (!parsed.success) return { ok: false, title: "Clock", message: "That number of days could not be read." };

  const started = elapsedMs();
  const change = await advanceClock(parsed.data.days, user.id);
  const result = await runReaper();

  revalidatePath("/demo");
  revalidatePath("/", "layout");

  return {
    ok: true,
    title: `Clock +${parsed.data.days} days`,
    message:
      `Offset is now ${change.offsetDays} day(s); the platform believes it is ` +
      `${change.now.toISOString().slice(0, 16).replace("T", " ")} UTC. ` +
      `The reaper scanned ${result.scanned} due deadline(s) and fired ${result.fired.length}` +
      `${result.errors.length > 0 ? `, with ${result.errors.length} error(s)` : ""}.`,
    fired: result.fired,
    ms: elapsedMs() - started,
  };
}

export async function resetClockAction(): Promise<DemoResult> {
  const user = await requireRole("ADMIN");
  const change = await resetClock(user.id);
  revalidatePath("/demo");
  revalidatePath("/", "layout");
  return {
    ok: true,
    title: "Clock reset",
    message: `Back on real time (was +${change.previousDays} day(s)). The amber banner is gone from every page.`,
  };
}

export async function reapNow(): Promise<DemoResult> {
  await requireRole("ADMIN");
  const started = elapsedMs();
  const result = await runReaper();
  revalidatePath("/demo");
  return {
    ok: true,
    title: "Reaper",
    message: `Scanned ${result.scanned}, fired ${result.fired.length}, ${result.errors.length} error(s).`,
    fired: result.fired,
    ms: elapsedMs() - started,
  };
}

/* --------------------------------------------------------- scenario beats */

const Scenario = z.object({ beat: z.string().min(2).max(40), trackingId: z.string().max(40).optional() });

/**
 * Walk a challenge forward along LEGAL edges only.
 *
 * The demo script compresses a nine-month lifecycle into six minutes, so the
 * publish and implement beats have to cross the intermediate states a real
 * project would spend weeks in. They are crossed one legal edge at a time
 * through the state machine, each writing its own ledger entry and its own SLA
 * deadlines — not by an UPDATE that skips them. A shortcut that jumped straight
 * to SOLUTION_PUBLISHED would leave a challenge whose history is a lie, on the
 * one page where a judge is most likely to look.
 */
async function walkTo(challengeId: string, from: ChallengeStatus, to: ChallengeStatus, actorId: string, projectId: string | null): Promise<ChallengeStatus> {
  const PATHS: Partial<Record<ChallengeStatus, ChallengeStatus[]>> = {
    CLAIMED: ["PROPOSAL_APPROVED", "IN_RESEARCH", "SOLUTION_PUBLISHED"],
    PROPOSAL_APPROVED: ["IN_RESEARCH", "SOLUTION_PUBLISHED"],
    IN_RESEARCH: ["SOLUTION_PUBLISHED"],
  };
  let current = from;
  if (current === to) return current;

  const steps = [...(PATHS[current] ?? []), to].filter((s, i, a) => a.indexOf(s) === i);
  for (const step of steps) {
    if (current === to) break;
    if (!canTransition(current, step)) continue;
    await db.transaction(async (tx) => {
      await transition(tx, {
        challengeId,
        to: step,
        actorId,
        projectId,
        lastActivityAt: clockNow(),
        reason: "Demo console: advancing the hero challenge one legal edge at a time.",
        meta: { by: "demo-console" },
      });
    });
    current = step;
    if (current === to) break;
  }
  return current;
}

/** The hero challenge the six-minute script follows. */
async function heroChallenge() {
  const [row] = await db
    .select({ id: challenges.id, trackingId: challenges.trackingId, status: challenges.status, title: challenges.title })
    .from(challenges)
    .where(eq(challenges.trackingId, process.env.DEMO_HERO_TRACKING_ID ?? "JH-2026-GUM-0001"))
    .limit(1);
  return row ?? null;
}

export async function runScenario(_prev: DemoResult | null, form: FormData): Promise<DemoResult> {
  const user = await requireRole("ADMIN");
  const parsed = Scenario.safeParse({ beat: form.get("beat"), trackingId: form.get("trackingId") ?? undefined });
  if (!parsed.success) return { ok: false, title: "Scenario", message: "Unknown beat." };
  const started = elapsedMs();

  const hero = await heroChallenge();
  if (!hero) return { ok: false, title: parsed.data.beat, message: "The hero challenge is not in the database. Run pnpm seed." };

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.challengeId, hero.id))
    .limit(1);

  const done = (message: string): DemoResult => ({ ok: true, title: parsed.data.beat, message, ms: elapsedMs() - started });

  switch (parsed.data.beat) {
    case "pipeline": {
      /**
       * Runs the AI pipeline on the hero challenge, exactly as /submit does.
       * The SSE trace on /submit/success is the version a judge watches; this is
       * the same orchestrator with a no-op emitter, for when the driver needs the
       * challenge moved without narrating the stages.
       */
      const { runPipeline } = await import("@/lib/ai/pipeline");
      const stages: string[] = [];
      await runPipeline(hero.id, async (event) => {
        if (event.type === "stage" && "stage" in event) stages.push(String(event.stage));
      });
      const [after] = await db
        .select({ status: challenges.status, score: challenges.priorityScore })
        .from(challenges)
        .where(eq(challenges.id, hero.id))
        .limit(1);
      revalidatePath("/demo");
      return done(
        `Pipeline complete on ${hero.trackingId}: ${hero.status} → ${after.status}` +
          `${after.score ? `, priority ${Number(after.score).toFixed(3)}` : ""}. ` +
          `Every stage wrote an ai_runs row; /admin/ai-runs is the receipt.`,
      );
    }

    case "claim": {
      /**
       * The HOD claims. Uses the same server action the claim form posts to, so
       * the capacity decrement, the credit edges and the ledger append all happen
       * exactly as they do in the UI. The citizen goes on the team as Domain
       * Informant by default — their place on the chain is never silently dropped.
       */
      if (!canTransition(hero.status, "CLAIMED")) {
        return done(`${hero.trackingId} is at ${hero.status}, which cannot legally reach CLAIMED. Release the gate first.`);
      }
      const { capabilities, routes } = await import("@/lib/db/schema");
      const [offer] = await db
        .select({ capabilityId: routes.capabilityId, orgId: routes.orgId })
        .from(routes)
        .where(eq(routes.challengeId, hero.id))
        .orderBy(routes.rank)
        .limit(1);
      if (!offer?.capabilityId) return done("No shortlist has been written for the hero challenge yet. Run the pipeline beat first.");

      const [cap] = await db
        .select({ department: capabilities.department })
        .from(capabilities)
        .where(eq(capabilities.id, offer.capabilityId))
        .limit(1);

      /**
       * Acts as the seeded head of department, not as the admin who pressed the
       * button: ADMIN is deliberately not a wildcard in `requireRole`, and a
       * shortcut that quietly ran as an admin would be a second, weaker claim
       * path. The impersonation is written to the audit log.
       */
      const { userProfiles, user: userTable, auditLog } = await import("@/lib/db/schema");
      const [hod] = await db
        .select({
          id: userProfiles.userId,
          fullName: userProfiles.fullName,
          orgId: userProfiles.orgId,
          districtCode: userProfiles.districtCode,
          blockCode: userProfiles.blockCode,
          role: userProfiles.role,
          preferredLang: userProfiles.preferredLang,
          verifiedTier: userProfiles.verifiedTier,
          email: userTable.email,
          name: userTable.name,
        })
        .from(userProfiles)
        .innerJoin(userTable, eq(userTable.id, userProfiles.userId))
        .where(eq(userProfiles.orgId, offer.orgId))
        .limit(1);
      if (!hod) return done(`No HEI member is registered against the institution this was offered to, so there is nobody to claim as.`);

      await db.insert(auditLog).values({
        actorId: user.id,
        action: "demo.claim.as",
        targetType: "user",
        targetId: hod.id,
        reason: "Demo console scenario shortcut acting as the seeded head of department.",
        meta: { trackingId: hero.trackingId, orgId: offer.orgId },
        createdAt: clockNow(),
      });

      const { claimAs } = await import("@/app/(hei)/hei/challenges/[trackingId]/claim/actions");
      const result = await claimAs(hod, {
        trackingId: hero.trackingId,
        capabilityId: offer.capabilityId,
        title: `${cap?.department ?? "Department"} final-year project: ${hero.title.slice(0, 90)}`,
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
      revalidatePath("/demo");
      return done(
        result.ok
          ? `Claimed by ${hod.fullName}. The team is on the public credit chain by name, with the citizen credited as Domain Informant.`
          : `Claim refused: ${JSON.stringify(result).slice(0, 200)}`,
      );
    }

    case "gate": {
      const { releaseGate } = await import("@/lib/ai/stages/s5");
      if (hero.status !== "PRIORITISED" && hero.status !== "VERIFIED") {
        return done(`${hero.trackingId} is already past the gate (${hero.status}). Nothing to release — idempotent by design.`);
      }
      const released = await releaseGate({
        challengeId: hero.id,
        trackingId: hero.trackingId,
        actorId: user.id,
        reason: "Released at the human gate during the demo.",
      });
      revalidatePath("/demo");
      return done(`Released. ${released.notified} notification(s) sent; the challenge is now ${released.status}.`);
    }

    case "implement": {
      const { markImplemented } = await import("@/lib/impact/implemented");
      const at = await walkTo(hero.id, hero.status, "SOLUTION_PUBLISHED", user.id, project?.id ?? null);
      if (!canTransition(at, "IMPLEMENTED")) {
        return done(`${hero.trackingId} is at ${at}, which cannot legally reach IMPLEMENTED. The state machine refuses illegal edges rather than letting the data drift.`);
      }
      const result = await markImplemented({
        challengeId: hero.id,
        actorId: user.id,
        claim: "Implementation claimed during the demo.",
      });
      revalidatePath("/demo");
      return done(
        `${result.trackingId} is IMPLEMENTED — a CLAIM, not an outcome. ${result.messaged} message(s) sent to the citizen. ` +
          `The impact counter has NOT moved. Open the SMS inbox below to see what Sunita received.`,
      );
    }

    case "confirm": {
      const { verifyToken } = await import("@/lib/verify/token");
      if (hero.status !== "IMPLEMENTED") {
        return done(`${hero.trackingId} is at ${hero.status}, not IMPLEMENTED. There is nothing for the citizen to confirm yet.`);
      }
      const { confirmImpact } = await import("@/app/(citizen)/me/verify/[token]/actions");
      const fd = new FormData();
      fd.set("token", verifyToken(hero.id));
      fd.set("answer", "YES");
      fd.set("note", "Confirmed by the citizen during the demo.");
      const result = await confirmImpact(null, fd);
      revalidatePath("/demo");
      revalidatePath("/stats");
      return done(result.message);
    }

    case "publish": {
      const { publishArtifact } = await import("@/lib/artifacts/publish");
      if (!project) return done("The hero challenge has no project yet. Run the claim beat first.");
      const result = await publishArtifact({
        projectId: project.id,
        kind: "REPORT",
        title: "Embankment fissure early warning: siting and thresholds",
        abstract:
          "A method for siting low-cost tilt sensors along an earthen embankment, and the displacement " +
          "thresholds that should trigger an evacuation advisory. Published under CC-BY so any district may reuse it.",
        licence: "CC_BY",
        authorId: user.id,
        file: { bytes: Buffer.from(`Milan demo artifact for ${hero.trackingId}\n`), mime: "application/pdf", name: "report.pdf" },
      });
      const reached = await walkTo(hero.id, hero.status, "SOLUTION_PUBLISHED", user.id, project.id);
      revalidatePath("/demo");
      return done(
        `Published, and the challenge walked ${hero.status} → ${reached} one legal edge at a time. ` +
          `Ledger entry ${result.ledgerSeq}, content hash ${result.contentHash.slice(0, 16)}…` +
          `${result.deduped ? " (identical bytes were already stored — that is the dedup working)" : ""}`,
      );
    }

    default:
      return { ok: false, title: parsed.data.beat, message: "That beat is not wired to a button." };
  }
}

/* --------------------------------------------------------------- the reset */

/**
 * Seed reset.
 *
 * Deliberately NOT a `pnpm seed --reset` shell-out: a web request that spawns a
 * process that truncates the database is a bad idea even on a demo laptop, and
 * on Vercel there is no shell to spawn into. This restores the demo STATE — the
 * clock, the SLA ladders, the escalation flags and the impact flags — which is
 * what actually drifts during a run-through. The full re-seed is one terminal
 * command and it is in the runbook.
 */
export async function resetDemoState(): Promise<DemoResult> {
  const user = await requireRole("ADMIN");
  const started = elapsedMs();

  await resetClock(user.id);
  await syncClockOffset(true);

  const { resetToSeedState } = await import("@/lib/demo/reset");
  const report = await resetToSeedState();

  revalidatePath("/demo");
  revalidatePath("/", "layout");
  revalidatePath("/stats");

  return {
    ok: report.orphansRemaining === 0,
    title: "Demo state reset",
    message:
      `Clock back to zero. ${report.statusesRestored} challenge status(es) restored from ` +
      `${report.usedSeedCsv ? "seed-data/challenges.csv" : "their current values (the CSV was not readable)"}, ` +
      `${report.flagsCleared} row(s) had their escalation and impact flags cleared, ` +
      `${report.deadlinesCancelled} open deadline(s) cancelled and ${report.deadlinesOpened} re-opened. ` +
      `Invariant 1: ${report.orphansRemaining} orphan(s). ` +
      `The ledger is untouched — it is append-only, and a reset that erased it would be exactly the ` +
      `thing we say cannot happen, so it carries every rehearsal.`,
    ms: elapsedMs() - started,
  };
}
