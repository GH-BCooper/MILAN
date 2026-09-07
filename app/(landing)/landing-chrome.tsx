import Link from "next/link";

import { RoleBadge } from "@/components/role-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/guards";

/** The landing site has its own chrome, but it is still auth-aware: a signed-in
 *  judge who lands back on "/" must see themselves signed in, with a route into
 *  their dashboard — not a "Sign in" button that implies they were logged out. */
export async function LandingHeader() {
  const user = await currentUser();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div aria-hidden className="milan-hairline h-px w-full opacity-70" />
      <div className="mx-auto flex w-full max-w-6xl items-center gap-x-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2 text-lg font-bold tracking-tight">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full bg-gradient-to-br from-[var(--grad-1)] to-[var(--grad-3)] transition-transform group-hover:scale-125"
          />
          <span className="milan-gradient-text">Milan</span>
        </Link>

        <nav aria-label="Portals" className="hidden flex-wrap items-center gap-x-1 text-sm md:flex">
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground" href="/portals/citizens">
            Citizens
          </Link>
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground" href="/portals/universities">
            Universities
          </Link>
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground" href="/portals/industry">
            Industry
          </Link>
          <Link className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground" href="/challenges">
            Challenges
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {user ? (
            <>
              <RoleBadge role={user.role} districtCode={user.districtCode} />
              <Link
                className="text-sm font-medium text-foreground/90 transition-colors hover:text-[var(--grad-3)]"
                href="/profile"
              >
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
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/submit">Report a problem</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="mt-20 border-t border-border/70">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <p>
          Smart India Hackathon 2026 · Problem statement SIH26043 · Government of Jharkhand ·
          Theme: Disaster Management. The impact counter moves only on a citizen-confirmed
          outcome; unconfirmed claims render grey everywhere, including CSR exports.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {[
            ["/challenges", "Challenges"],
            ["/stats", "Public statistics"],
            ["/ledger", "Credit ledger"],
            ["/bounties", "Bounties"],
            ["/track", "Track a report"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="underline decoration-[var(--grad-1)] underline-offset-4 transition-colors hover:text-[var(--grad-3)]"
            >
              {label}
            </Link>
          ))}
        </p>
      </div>
    </footer>
  );
}

/** Chrome for a portal overview page: landing header, a titled hero, content,
 *  landing footer. Portal pages are public marketing-with-teeth — they explain
 *  what the role gets and then hand it a route into the real dashboard. */
export function PortalShell({
  eyebrow,
  title,
  titleHi,
  lede,
  primary,
  secondary,
  children,
}: {
  eyebrow: string;
  title: string;
  titleHi: string;
  lede: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <LandingHeader />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14">
          <div className="milan-rise">
            <span className="milan-glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-[var(--grad-3)]" />
              {eyebrow}
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">{title}</h1>
            <p lang="hi" className="mt-1 text-lg text-muted-foreground">
              {titleHi}
            </p>
            <div aria-hidden className="milan-hairline mt-4 h-px w-32 rounded-full" />
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-foreground">{lede}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={primary.href}>{primary.label}</Link>
              </Button>
              {secondary ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={secondary.href}>{secondary.label}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
        <div className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">{children}</div>
      </main>
      <LandingFooter />
    </>
  );
}

/** A grid of routes into the real product. Every card is a live link — a
 *  portal page that describes a feature it cannot open is a brochure. */
export function FeatureGrid({
  heading,
  blurb,
  features,
}: {
  heading: string;
  blurb?: string;
  features: ReadonlyArray<{
    href: string;
    title: string;
    body: string;
    tag?: string;
  }>;
}) {
  return (
    <section className="py-8">
      <h2 className="text-2xl font-bold tracking-tight">{heading}</h2>
      {blurb ? (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{blurb}</p>
      ) : null}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Link
            key={f.href + f.title}
            href={f.href}
            className="milan-glass group flex flex-col rounded-xl p-5 transition-all hover:-translate-y-1 hover:border-[var(--grad-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-base font-semibold">{f.title}</span>
              {f.tag ? (
                <span className="shrink-0 rounded-full border border-border bg-foreground/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {f.tag}
                </span>
              ) : null}
            </div>
            <span className="mt-2 text-sm leading-snug text-muted-foreground">{f.body}</span>
            <span className="mt-4 text-sm font-semibold milan-gradient-text">Open →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** A numbered walk-through of what actually happens, in order. */
export function StepList({
  heading,
  steps,
}: {
  heading: string;
  steps: ReadonlyArray<{ title: string; body: string }>;
}) {
  return (
    <section className="py-8">
      <h2 className="text-2xl font-bold tracking-tight">{heading}</h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="milan-glass flex gap-4 rounded-xl p-5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--grad-1)] to-[var(--grad-2)] text-sm font-bold text-white"
            >
              {i + 1}
            </span>
            <span>
              <span className="block text-base font-semibold">{s.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
