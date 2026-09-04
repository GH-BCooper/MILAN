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
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Government of Jharkhand · Disaster risk reduction
      </p>

      <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Milan</h1>

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
            className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon aria-hidden className="size-5 text-primary" />
            <span className="mt-3 text-base font-semibold">{title}</span>
            <span lang="hi" className="text-sm text-muted-foreground">
              {titleHi}
            </span>
            <span className="mt-2 text-sm leading-snug text-muted-foreground">{body}</span>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Open <ArrowRight aria-hidden className="size-4" />
            </span>
          </Link>
        ))}
      </nav>

      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>
          Smart India Hackathon 2026 · Problem statement SIH26043 · Theme: Disaster Management.
          Impact counts only citizen-confirmed outcomes.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link className="underline underline-offset-4 hover:text-foreground" href="/stats">
            Public statistics
          </Link>
          <Link className="underline underline-offset-4 hover:text-foreground" href="/ledger">
            Credit ledger
          </Link>
          <Link className="underline underline-offset-4 hover:text-foreground" href="/bounties">
            Bounties
          </Link>
        </p>
      </footer>
    </main>
  );
}
