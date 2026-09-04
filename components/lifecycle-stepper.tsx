import { STATUS_LABEL } from "@/components/status-badge";
import { TERMINAL_STATES } from "@/lib/db/stateMachine";
import type { ChallengeStatus } from "@/lib/db/schema";

/**
 * The lifecycle, shown to a citizen as a horizontal stepper.
 *
 * Only the spine is drawn. A challenge that has branched off it — merged,
 * forwarded to CPGRAMS, parked — gets an explicit sentence instead of a
 * misleading position on a line it is no longer on.
 */
const SPINE: ChallengeStatus[] = [
  "SUBMITTED",
  "TRIAGED",
  "CLASSIFIED",
  "CLUSTERED",
  "PRIORITISED",
  "VERIFIED",
  "ROUTED",
  "CLAIMED",
  "PROPOSAL_APPROVED",
  "IN_RESEARCH",
  "SOLUTION_PUBLISHED",
  "IMPLEMENTED",
  "CITIZEN_VERIFIED",
  "CLOSED",
];

/** What a branch state means, in the citizen's terms. */
const BRANCH_EXPLANATION: Partial<Record<ChallengeStatus, string>> = {
  MERGED: "This report was joined with an identical one. Both reporters are credited.",
  FORWARDED_EXTERNAL:
    "This is a complaint with a known fix, so it was forwarded to CPGRAMS rather than sent to a university.",
  NEEDS_MORE_INFO: "We asked the reporter a follow-up question and are waiting for the answer.",
  REJECTED_UNSAFE: "This report was rejected because acting on it could put somebody at risk.",
  WITHDRAWN: "The reporter withdrew this report.",
  PARKED:
    "No team could take this on. It is parked and comes back for review automatically every year.",
  UNCLAIMED_ESCALATED:
    "No department claimed this in time, so it has been escalated to a wider set of institutions.",
  BOUNTY_LISTED: "This is listed as a bounty: any team may take it on.",
  AT_RISK: "The team working on this has gone quiet. The clock is running.",
  FORKED: "Another team has taken this on. The original team keeps its credit.",
  DISPUTED: "Somebody has disputed the outcome recorded here.",
  INDUSTRY_INTEREST: "An industry partner has expressed interest in funding or implementing this.",
  AGREEMENT_SIGNED: "An agreement has been signed to take this forward.",
  PILOT: "A pilot is running.",
};

export function LifecycleStepper({ status }: { status: ChallengeStatus }) {
  const onSpine = SPINE.indexOf(status);
  const explanation = BRANCH_EXPLANATION[status];
  const isTerminal = (TERMINAL_STATES as readonly string[]).includes(status);

  return (
    <div>
      <ol className="flex flex-wrap gap-1" aria-label="Progress through the lifecycle">
        {SPINE.map((s, i) => {
          const reached = onSpine >= 0 && i <= onSpine;
          const current = onSpine === i;
          return (
            <li key={s} className="flex-1 basis-8">
              <div
                className={`h-1.5 rounded-full ${
                  current ? "bg-primary" : reached ? "bg-primary/50" : "bg-border"
                }`}
                aria-hidden
              />
              <span className="sr-only">
                {STATUS_LABEL[s]}
                {current ? " — current stage" : reached ? " — done" : " — not yet"}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-sm">
        <span className="font-semibold">{STATUS_LABEL[status]}</span>
        {onSpine >= 0 ? (
          <span className="text-muted-foreground">
            {" "}
            · stage {onSpine + 1} of {SPINE.length}
          </span>
        ) : null}
        {isTerminal ? <span className="text-muted-foreground"> · this report is closed</span> : null}
      </p>

      {explanation ? <p className="mt-1 text-sm text-muted-foreground">{explanation}</p> : null}
    </div>
  );
}
