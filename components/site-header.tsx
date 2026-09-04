import Link from "next/link";

import { RoleBadge } from "@/components/role-badge";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/guards";

/** Where each role lands when it clicks its own name. */
const HOME_FOR = {
  CITIZEN: "/me",
  HEI_MEMBER: "/hei",
  INDUSTRY: "/industry/discover",
  GOVERNMENT: "/gov",
  ADMIN: "/admin/triage",
  ASSISTED_SUBMITTER: "/me",
  INDEPENDENT_INNOVATOR: "/me",
  EXPERT_PANEL: "/gov",
} as const;

export async function SiteHeader() {
  const user = await currentUser();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Milan
        </Link>

        <nav aria-label="Public" className="flex flex-wrap items-center gap-x-4 text-sm">
          <Link className="hover:underline underline-offset-4" href="/challenges">
            Challenges
          </Link>
          <Link className="hover:underline underline-offset-4" href="/track">
            Track
          </Link>
          <Link className="hover:underline underline-offset-4" href="/stats">
            Statistics
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-3">
          {user ? (
            <>
              <RoleBadge role={user.role} districtCode={user.districtCode} />
              <Link className="text-sm hover:underline underline-offset-4" href={HOME_FOR[user.role]}>
                {user.fullName}
              </Link>
              <Button asChild variant="outline" size="sm">
                <Link href="/logout">Sign out</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/submit">Report a problem</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
