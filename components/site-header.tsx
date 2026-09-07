import Link from "next/link";

import { RoleBadge } from "@/components/role-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentUser } from "@/lib/auth/guards";
import type { Role } from "@/lib/db/schema";

interface NavLink {
  href: string;
  label: string;
  /** Sub-links rendered as a dropdown under this item instead of a bare link. */
  children?: ReadonlyArray<[string, string]>;
}

/** Every logged-out visitor and every citizen sees the same three public
 *  surfaces, with Track and Statistics nested under Challenges (item 2). */
const CHALLENGES_GROUP: NavLink = {
  href: "/challenges",
  label: "Challenges",
  children: [
    ["/challenges", "All challenges"],
    ["/track", "Track"],
    ["/stats", "Statistics"],
  ],
};

/** What each signed-in role can navigate to from the shared header. A citizen
 *  never sees university, industry or government links (item 8) — only their
 *  own surfaces plus the public challenge list. The admin (item 9a) sees every
 *  *other* portal, but explicitly not government — a gov decision is a distinct
 *  chain of custody, see lib/auth/guards.ts. */
const ROLE_NAV: Partial<Record<Role, ReadonlyArray<NavLink>>> = {
  CITIZEN: [{ href: "/me", label: "My reports" }, CHALLENGES_GROUP],
  HEI_MEMBER: [
    { href: "/hei", label: "My institution" },
    { href: "/hei/inbox", label: "Routed to us" },
    { href: "/hei/challenge-bank", label: "Challenge bank" },
    { href: "/submit-question", label: "Submit a question" },
  ],
  INDUSTRY: [
    { href: "/industry/discover", label: "Challenges" },
    { href: "/industry/solutions", label: "Solutions" },
    { href: "/industry/csr", label: "CSR" },
    { href: "/submit-question", label: "Submit a problem" },
  ],
  GOVERNMENT: [
    { href: "/gov", label: "District desk" },
    { href: "/gov/gate", label: "Severity gate" },
    { href: "/gov/sla", label: "SLA" },
    CHALLENGES_GROUP,
  ],
  ADMIN: [
    { href: "/admin/triage", label: "Triage" },
    { href: "/admin/verification", label: "Verification" },
    { href: "/admin/routing", label: "Routing" },
    { href: "/admin/challenges", label: "Challenges (manage)" },
    { href: "/admin/bugs", label: "Bugs" },
    { href: "/admin/stats", label: "Stats" },
    { href: "/admin/ai-runs", label: "AI runs" },
    { href: "/me", label: "Citizen" },
    { href: "/hei", label: "University" },
    { href: "/industry/discover", label: "Industry" },
  ],
};

const DEFAULT_NAV: ReadonlyArray<NavLink> = [CHALLENGES_GROUP];

function NavItem({ item }: { item: NavLink }) {
  if (!item.children) {
    return (
      <Link
        className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
        href={item.href}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full px-3 py-1.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground">
        {item.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {item.children.map(([href, label]) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>{label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export async function SiteHeader() {
  const user = await currentUser();
  const nav: ReadonlyArray<NavLink> = user ? ROLE_NAV[user.role] ?? DEFAULT_NAV : DEFAULT_NAV;

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
          {nav.map((item) => (
            <NavItem key={item.href} item={item} />
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
                <Link href="/report-bug">Report a bug</Link>
              </Button>
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
                <Link href="/report-bug">Report a bug</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
