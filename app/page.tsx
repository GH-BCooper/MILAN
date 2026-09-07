import Link from "next/link";
import { ArrowRight, FileText, Map, Search } from "lucide-react";

const ACTIONS = [
  {
    href: "/submit",
    title: "Report a problem",
    titleHi: "समस्या दर्ज करें",
    body: "Describe it in Hindi or English. Add a photo and a location. You get a tracking ID in seconds.",
    icon: FileText,
  },
  {
    href: "/challenges",
    title: "Browse challenges",
    titleHi: "चुनौतियाँ देखें",
    body: "Every problem on the platform, on a map and in a list, with its status and its district.",
    icon: Map,
  },
  {
    href: "/track",
    title: "Track your report",
    titleHi: "अपनी रिपोर्ट देखें",
    body: "Enter your tracking ID. No login needed, ever.",
    icon: Search,
  },
];

export default function HomePage() {
  return (
    <main className="relative mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      {/* the halo behind the wordmark — decorative, never carries meaning */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-[36rem] max-w-[110vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(124,92,255,0.35),transparent_65%)] blur-2xl"
      />

      <span className="milan-glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-[var(--grad-3)] shadow-[0_0_10px_2px_rgba(34,211,238,0.9)]"
        />
        Government of Jharkhand · Disaster risk reduction
      </span>

      <h1 className="mt-5 text-5xl font-bold tracking-tight sm:text-7xl">Milan</h1>
      <div aria-hidden className="milan-hairline mt-4 h-px w-40 rounded-full" />

      <p className="mt-4 text-lg leading-relaxed text-foreground">
        Milan turns a verified local problem into a{" "}
        <strong className="font-semibold">time-bound, routed research assignment</strong> for a
        university team — with a hash-chained credit ledger so nobody&rsquo;s contribution can be
        erased, and an SLA clock so no challenge can silently die.
      </p>

      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        This is mitigation and preparedness, not response. It is not a grievance portal: a complaint
        with a known fix belongs with CPGRAMS, and we forward it there. An unsolved problem belongs
        in a lab, with a clock on it.
      </p>

      <nav className="mt-10 grid gap-4 sm:grid-cols-3" aria-label="Main actions">
        {ACTIONS.map(({ href, title, titleHi, body, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="milan-glass group relative flex flex-col overflow-hidden rounded-xl p-5 transition-all hover:-translate-y-1 hover:border-[var(--grad-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-px milan-hairline opacity-70"
            />
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--grad-1)] to-[var(--grad-2)] text-white shadow-[0_10px_28px_-12px_rgba(124,92,255,0.9)] transition-transform group-hover:scale-110"
            >
              <Icon className="size-5" />
            </span>
            <span className="mt-3 text-base font-semibold">{title}</span>
            <span lang="hi" className="text-sm text-muted-foreground">
              {titleHi}
            </span>
            <span className="mt-2 text-sm leading-snug text-muted-foreground">{body}</span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold milan-gradient-text">
              Open <ArrowRight aria-hidden className="size-4 text-[var(--grad-3)] transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </nav>

      <footer className="mt-14 border-t border-border/70 pt-6 text-sm text-muted-foreground">
        <p>
          Smart India Hackathon 2026 · Problem statement SIH26043 · Theme: Disaster Management.
          Impact counts only citizen-confirmed outcomes.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link className="underline decoration-[var(--grad-1)] underline-offset-4 transition-colors hover:text-[var(--grad-3)]" href="/stats">
            Public statistics
          </Link>
          <Link className="underline decoration-[var(--grad-1)] underline-offset-4 transition-colors hover:text-[var(--grad-3)]" href="/ledger">
            Credit ledger
          </Link>
          <Link className="underline decoration-[var(--grad-1)] underline-offset-4 transition-colors hover:text-[var(--grad-3)]" href="/bounties">
            Bounties
          </Link>
        </p>
      </footer>
    </main>
  );
}
