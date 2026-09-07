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
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
      {/* the hairline of light that runs under every screen's chrome */}
      <div aria-hidden className="milan-hairline h-px w-full opacity-70" />
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2 text-lg font-bold tracking-tight">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full bg-gradient-to-br from-[var(--grad-1)] to-[var(--grad-3)] shadow-[0_0_14px_2px_rgba(124,92,255,0.8)] transition-transform group-hover:scale-125"
          />
          <span className="milan-gradient-text">Milan</span>
        </Link>

        <nav aria-label="Public" className="flex flex-wrap items-center gap-x-1 text-sm">
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground" href="/challenges">
            Challenges
          </Link>
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground" href="/track">
            Track
          </Link>
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground" href="/stats">
            Statistics
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-3">
          {user ? (
            <>
              <RoleBadge role={user.role} districtCode={user.districtCode} />
              <Link className="text-sm font-medium text-foreground/90 transition-colors hover:text-[var(--grad-3)]" href={HOME_FOR[user.role]}>
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
