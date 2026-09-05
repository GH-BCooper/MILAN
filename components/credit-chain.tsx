/**
 * The credit chain, rendered as the ordered graph it is.
 *
 * citizen (originator) → corroborators → team members with declared roles →
 * mentor → funder → implementer. A merged reporter appears as a corroborator
 * rather than disappearing, and a forked-from team keeps its place in the order
 * with its contribution stated — because the alternative, quietly dropping them
 * once a second team takes over, is exactly the erasure Milan exists to prevent.
 *
 * Every node links to that person's public credit record.
 */
import Link from "next/link";

export interface CreditNode {
  id: string;
  relation: string;
  /** Displayed name. Team members are credited by NAME, never by email. */
  name: string;
  declaredRole: string | null;
  orgName: string | null;
  userId: string | null;
  at: Date;
  /** Set on a node inherited from a team that was forked from. */
  forkedFrom?: boolean;
  note?: string | null;
}

/** The order the chain is read in. Anything unrecognised sorts last, in time order. */
const ORDER = ["ORIGINATOR", "CORROBORATOR", "TEAM_MEMBER", "MENTOR", "FUNDER", "IMPLEMENTER"];

const RELATION_LABEL: Record<string, string> = {
  ORIGINATOR: "Originator",
  CORROBORATOR: "Corroborator",
  TEAM_MEMBER: "Team member",
  MENTOR: "Mentor",
  FUNDER: "Funder",
  IMPLEMENTER: "Implementer",
};

const RELATION_BLURB: Record<string, string> = {
  ORIGINATOR: "Noticed the problem and reported it. The chain starts here and cannot be re-rooted.",
  CORROBORATOR: "Reported the same problem independently, or had their report merged into this one. Both reporters are credited.",
  TEAM_MEMBER: "Did the work, with the role they declared for themselves.",
  MENTOR: "Supervised the project.",
  FUNDER: "Paid for the implementation.",
  IMPLEMENTER: "Built or installed the thing on the ground.",
};

const RELATION_COLOUR: Record<string, string> = {
  ORIGINATOR: "border-emerald-300 bg-emerald-50",
  CORROBORATOR: "border-teal-200 bg-teal-50",
  TEAM_MEMBER: "border-blue-200 bg-blue-50",
  MENTOR: "border-indigo-200 bg-indigo-50",
  FUNDER: "border-amber-200 bg-amber-50",
  IMPLEMENTER: "border-purple-200 bg-purple-50",
};

export function sortCreditNodes(nodes: CreditNode[]): CreditNode[] {
  return [...nodes].sort((a, b) => {
    const ai = ORDER.indexOf(a.relation);
    const bi = ORDER.indexOf(b.relation);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.at.getTime() - b.at.getTime();
  });
}

export function CreditChain({ nodes, trackingId }: { nodes: CreditNode[]; trackingId: string }) {
  const ordered = sortCreditNodes(nodes);

  if (ordered.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
        No credit has been recorded on {trackingId} yet. The first edge is written the moment the
        report is accepted, so this is only ever empty for a report that has not been through triage.
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {ordered.map((node, i) => (
        <li key={node.id} className="relative">
          {i > 0 ? <div aria-hidden className="ml-6 h-4 w-px bg-border" /> : null}
          <div className={`rounded-lg border p-3 ${RELATION_COLOUR[node.relation] ?? "border-border bg-muted"}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded border border-black/10 bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {RELATION_LABEL[node.relation] ?? node.relation.replace(/_/g, " ")}
              </span>
              {node.userId ? (
                <Link href={`/credit/${node.userId}`} className="text-sm font-semibold underline-offset-4 hover:underline">
                  {node.name}
                </Link>
              ) : (
                <span className="text-sm font-semibold">{node.name}</span>
              )}
              {node.declaredRole ? (
                <span className="text-xs text-muted-foreground">— {node.declaredRole}</span>
              ) : null}
              {node.orgName ? <span className="text-xs text-muted-foreground">· {node.orgName}</span> : null}
              <span className="ms-auto text-[11px] text-muted-foreground">
                {node.at.toISOString().slice(0, 10)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {node.note ?? RELATION_BLURB[node.relation] ?? "Contributed to this challenge."}
            </p>
            {node.forkedFrom ? (
              <p className="mt-1 rounded bg-white/70 px-2 py-1 text-[11px] font-medium">
                Carried over from the team that started this work. Their contribution is preserved and
                attributed even though another team finished it.
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
