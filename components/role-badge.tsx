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

const TONE: Record<Role, string> = {
  CITIZEN: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  HEI_MEMBER: "bg-indigo-500/15 text-indigo-200 border-indigo-400/40",
  INDUSTRY: "bg-amber-500/15 text-amber-200 border-amber-400/40",
  GOVERNMENT: "bg-sky-500/15 text-sky-200 border-sky-400/40",
  ADMIN: "bg-neutral-500/15 text-neutral-200 border-neutral-400/40",
  ASSISTED_SUBMITTER: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
  INDEPENDENT_INNOVATOR: "bg-violet-500/15 text-violet-200 border-violet-400/40",
  EXPERT_PANEL: "bg-rose-500/15 text-rose-200 border-rose-400/40",
};

export function RoleBadge({ role, districtCode }: { role: Role; districtCode?: string | null }) {
  return (
    <Badge variant="outline" className={`font-medium backdrop-blur-md ${TONE[role]}`}>
      {LABEL[role]}
      {districtCode ? ` · ${districtCode}` : ""}
    </Badge>
  );
}
