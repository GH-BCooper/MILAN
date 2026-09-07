import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/db/schema";

/**
 * Who is logged in, visible at a glance. On stage we switch between five
 * accounts in ninety seconds; the audience has to be able to see which one
 * without being told. Colour is never the only signal — the role name is
 * always spelled out.
 */
const LABEL: Record<Role, string> = {
  CITIZEN: "Citizen",
  HEI_MEMBER: "University",
  INDUSTRY: "Industry",
  GOVERNMENT: "Government",
  ADMIN: "Admin",
  ASSISTED_SUBMITTER: "Assisted submitter",
  INDEPENDENT_INNOVATOR: "Independent innovator",
  EXPERT_PANEL: "Expert panel",
};

/* Every tone carries a light-mode dark-text pair AND a dark-mode pale-text
   pair — the earlier `text-*-200`-only values were invisible on the light
   ground (the "Admin" chip vanished in daylight). */
const TONE: Record<Role, string> = {
  CITIZEN: "bg-emerald-500/12 text-emerald-800 border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  HEI_MEMBER: "bg-indigo-500/12 text-indigo-800 border-indigo-400/40 dark:bg-indigo-500/15 dark:text-indigo-200",
  INDUSTRY: "bg-amber-500/15 text-amber-800 border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  GOVERNMENT: "bg-sky-500/12 text-sky-800 border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-200",
  ADMIN: "bg-slate-500/15 text-slate-700 border-slate-400/50 dark:bg-slate-500/15 dark:text-slate-200",
  ASSISTED_SUBMITTER: "bg-emerald-500/12 text-emerald-800 border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
  INDEPENDENT_INNOVATOR: "bg-violet-500/12 text-violet-800 border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200",
  EXPERT_PANEL: "bg-rose-500/12 text-rose-800 border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-200",
};

export function RoleBadge({ role, districtCode }: { role: Role; districtCode?: string | null }) {
  return (
    <Badge variant="outline" className={`font-medium backdrop-blur-md ${TONE[role]}`}>
      {LABEL[role]}
      {districtCode ? ` · ${districtCode}` : ""}
    </Badge>
  );
}
