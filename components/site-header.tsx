import Link from "next/link";

import { RoleBadge } from "@/components/role-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/guards";
import type { Role } from "@/lib/db/schema";

/** What each signed-in role can navigate to from the shared header. The admin
 *  (item 9a) sees every portal; the others see only their own surfaces plus
 *  the public challenge list. */
const ROLE_NAV: Partial<Record<Role, ReadonlyArray<[string, string]>>> = {
  CITIZEN: [
    ["/me", "My reports"],
    ["/challenges", "Challenges"],
    ["/track", "Track"],
  ],
  HEI_MEMBER: [
    ["/hei", "My institution"],
    ["/hei/inbox", "Routed to us"],
    ["/hei/challenge-bank", "Submit a question"],
    ["/challenges", "Challenges"],
  ],
  INDUSTRY: [
    ["/industry/discover", "Discover"],
    ["/industry/csr", "CSR"],
    ["/challenges", "Challenges"],
  ],
  GOVERNMENT: [
    ["/gov", "District desk"],
    ["/gov/gate", "Severity gate"],
    ["/gov/sla", "SLA"],
    ["/challenges", "Challenges"],
  ],
  ADMIN: [
    ["/admin/triage", "Triage"],
    ["/admin/verification", "Verification"],
    ["/admin/routing", "Routing"],
    ["/admin/challenges", "Challenges (manage)"],
    ["/admin/stats", "Stats"],
    ["/admin/ai-runs", "AI runs"],
    ["/me", "Citizen"],
    ["/hei", "University"],
    ["/industry/discover", "Industry"],
    ["/gov", "Government"],
  ],
};

export async function SiteHeader() {
  const user = await currentUser();
  const nav: ReadonlyArray<[string, string]> = user
    ? ROLE_NAV[user.role] ?? [["/challenges", "Challenges"], ["/track", "Track"], ["/stats", "Statistics"]]
    : [["/challenges", "Challenges"], ["/track", "Track"], ["/stats", "Statistics"]];

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

        <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-1 text-sm">
          {nav.map(([href, label]) => (
            <Link
              key={href}
              className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
              href={href}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <>
              <RoleBadge role={user.role} districtCode={user.districtCode} />
              <Link className="text-sm font-medium text-foreground/90 transition-colors hover:text-[var(--grad-3)]" href="/profile">
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
