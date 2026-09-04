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
  CITIZEN: "bg-emerald-100 text-emerald-900 border-emerald-300",
  HEI_MEMBER: "bg-indigo-100 text-indigo-900 border-indigo-300",
  INDUSTRY: "bg-amber-100 text-amber-900 border-amber-300",
  GOVERNMENT: "bg-sky-100 text-sky-900 border-sky-300",
  ADMIN: "bg-neutral-200 text-neutral-900 border-neutral-400",
  ASSISTED_SUBMITTER: "bg-emerald-50 text-emerald-900 border-emerald-300",
  INDEPENDENT_INNOVATOR: "bg-violet-100 text-violet-900 border-violet-300",
  EXPERT_PANEL: "bg-rose-100 text-rose-900 border-rose-300",
};

export function RoleBadge({ role, districtCode }: { role: Role; districtCode?: string | null }) {
  return (
    <Badge variant="outline" className={`font-medium ${TONE[role]}`}>
      {LABEL[role]}
      {districtCode ? ` · ${districtCode}` : ""}
    </Badge>
  );
}
