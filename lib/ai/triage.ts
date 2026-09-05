/**
 * S1's decision layer. Pure: no database, no network, no provider chain.
 *
 * CLAUDE.md invariant 3 in two files. `lib/ai/stages/s1.ts` asks the model what
 * it sees; this file decides what Milan does about it. Every threshold is here,
 * every branch is here, and `tests/triage.test.ts` exercises all of them
 * without a Supabase connection — which is the point. A decision layer you
 * cannot test offline is a decision layer nobody checks.
 */
import { HELPLINE_FOR, hasGrievanceEvidence } from "./gazetteer";
import type { S1Output } from "./schemas";

/**
 * The thresholds. Every one of these numbers is a policy choice, not a
 * measurement, and each is cited where it came from.
 */
export const S1_THRESHOLDS = {
  /** Reject and purge media at or above this. Below it, a human looks first.
   *  PHASE_2_BUILD.md Task 2.2. */
  unsafe: 0.6,
  /** Forward to CPGRAMS/JharSewa at or above this. Higher than the unsafe bar
   *  because wrongly forwarding a research problem sends it to an officer with
   *  no mandate to solve it, and the citizen hears nothing again. */
  grievance: 0.7,
  /** Below this, nothing is decided automatically: the item goes to a human at
   *  /admin/triage. A level-2 rules answer (0.45) always lands here. */
  humanQueue: 0.6,
} as const;

export type S1Decision =
  | { kind: "REJECT_UNSAFE"; category: string; helpline: { number: string; label: string } }
  | { kind: "FORWARD_EXTERNAL"; target: string; reference: string }
  | { kind: "HUMAN_QUEUE"; why: string }
  | { kind: "CONTINUE" };

/**
 * What the platform does about it. Deterministic, ordered, and testable without
 * a network: safety first, then grievance, then the confidence floor.
 */
export function decideS1(out: S1Output, trackingId: string, text: string): S1Decision {
  if (out.is_unsafe && out.confidence >= S1_THRESHOLDS.unsafe) {
    const category = out.unsafe_category ?? "UNKNOWN";
    return { kind: "REJECT_UNSAFE", category, helpline: helplineFor(category) };
  }

  if (out.is_grievance && out.confidence >= S1_THRESHOLDS.grievance) {
    // The model's judgement is necessary but not sufficient for an irreversible
    // action. FORWARDED_EXTERNAL is a terminal state: get this wrong and the
    // citizen's problem is handed to an officer with no method to solve it, and
    // there is no edge back. So the code also demands hard evidence in the text
    // that a grievance system already owns this -- a named scheme, a sanctioned
    // work, a withheld entitlement, a bribe.
    //
    // This is invariant 3 doing real work rather than decorating a diagram: the
    // AI proposes, deterministic code decides, and where the decision cannot be
    // undone the code asks for more than the model's confidence. Measured on the
    // seed set, the model forwarded five research problems this caught, while
    // both genuine grievances carry the evidence and still forward.
    if (!hasGrievanceEvidence(text)) {
      return {
        kind: "HUMAN_QUEUE",
        why:
          `S1 called this a grievance at ${out.confidence.toFixed(2)}, but the report names no ` +
          `scheme, sanctioned work or withheld entitlement. Forwarding cannot be undone, so a human decides.`,
      };
    }
    const target = out.grievance_target === "JharSewa" ? "JharSewa" : "CPGRAMS";
    return { kind: "FORWARD_EXTERNAL", target, reference: mockReference(target, trackingId) };
  }

  if (out.confidence < S1_THRESHOLDS.humanQueue) {
    return {
      kind: "HUMAN_QUEUE",
      why: `S1 confidence ${out.confidence.toFixed(2)} is below the ${S1_THRESHOLDS.humanQueue} floor.`,
    };
  }

  return { kind: "CONTINUE" };
}

/* --------------------------------------------------------------- helplines */

/** A rejected report is never a dead end: the citizen is shown where to go. */
export function helplineFor(category: string): { number: string; label: string } {
  return HELPLINE_FOR[category] ?? HELPLINE_FOR.UNKNOWN;
}

/* ------------------------------------------------------- the handoff contract */

/**
 * A mock CPGRAMS/JharSewa reference number.
 *
 * Declared stub: there is no public CPGRAMS write API we can integrate against
 * for a hackathon build. What we do instead is show the exact JSON payload we
 * would POST, on the challenge page, so the integration is a credential away
 * rather than a rewrite. That contract is the live answer to "why not just use
 * CPGRAMS" — we are not competing with it, we feed it.
 *
 * Deterministic on the tracking ID so a replay produces the same reference.
 */
export function mockReference(target: string, trackingId: string): string {
  const prefix = target === "JharSewa" ? "JHS" : "CPG";
  // The district segment is load-bearing. Stripping the letters out of
  // JH-2026-CHA-0001 and JH-2026-DEO-0001 leaves the same eight digits, and the
  // first run handed two different grievances the same reference number.
  const parts = trackingId.toUpperCase().split("-");
  const district = parts.at(-2) ?? "JH";
  const sequence = (parts.at(-1) ?? "0").replace(/\D/g, "").padStart(4, "0");
  const year = parts.at(1) ?? "2026";
  return `${prefix}/JH/${year}/${district}/${sequence}`;
}

export interface HandoffContract {
  endpoint: string;
  method: "POST";
  note: string;
  payload: Record<string, unknown>;
}

/** The payload we would POST. Rendered on the challenge page, verbatim. */
export function handoffContract(args: {
  target: string;
  reference: string;
  trackingId: string;
  title: string;
  bodyOriginal: string;
  bodyLang: string;
  bodyEn: string | null;
  districtCode: string | null;
  blockCode: string | null;
  reporterName: string | null;
  rationale: string;
  createdAt: Date;
}): HandoffContract {
  const endpoint =
    args.target === "JharSewa"
      ? "https://jharsewa.jharkhand.gov.in/api/v1/grievance"
      : "https://pgportal.gov.in/api/v1/grievance";

  return {
    endpoint,
    method: "POST",
    note:
      "Declared stub: neither portal exposes a public write API to a hackathon build, so Milan " +
      "generates the reference locally and shows the payload it would send. Nothing about the " +
      "grievance is hidden from the citizen, and the challenge page tells them where it went.",
    payload: {
      source: "MILAN",
      source_reference: args.trackingId,
      external_reference: args.reference,
      received_at: args.createdAt.toISOString(),
      state: "JHARKHAND",
      district_code: args.districtCode,
      block_code: args.blockCode,
      category: "PUBLIC_SERVICE_DELIVERY",
      subject: args.title,
      // Invariant 6: the citizen's own words travel with the grievance. We do
      // not forward only our translation of them.
      description_original: args.bodyOriginal,
      description_language: args.bodyLang,
      description_en: args.bodyEn,
      complainant_name: args.reporterName,
      routing_rationale: args.rationale,
      callback_url: `/c/${args.trackingId}`,
    },
  };
}
