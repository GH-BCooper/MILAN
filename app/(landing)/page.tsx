import Link from "next/link";
import {
  ArrowRight,
  Building2,
  FileText,
  GraduationCap,
  Landmark,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";

import { IndiaMap } from "@/components/india-map";
import { Button } from "@/components/ui/button";

import { LandingFooter, LandingHeader } from "./landing-chrome";

/** The three doors. Each one leads to a portal overview page, which in turn
 *  routes into that role's real dashboard. Citizens get the shallow door on
 *  purpose — a person reporting a flooded culvert should not have to read a
 *  capability matrix to find the button. */
const PORTALS = [
  {
    href: "/portals/citizens",
    icon: Users,
    name: "Citizens",
    nameHi: "नागरिक",
    tagline: "Report it. Track it. Confirm it.",
    body:
      "Describe a problem in Hindi or English, get a tracking ID in seconds, and confirm when it is actually fixed. A verified account keeps every report attached to you.",
    points: ["Bilingual submission", "Email + phone verified", "You confirm the outcome"],
    accent: "from-[var(--grad-3)] to-[var(--grad-2)]",
  },
  {
    href: "/portals/universities",
    icon: GraduationCap,
    name: "Universities",
    nameHi: "विश्वविद्यालय",
    tagline: "Real final-year projects, with a clock on them.",
    body:
      "200,000 Indian students invent a fake final-year project every year. Claim a routed, verified challenge instead — matched to your declared capability.",
    points: ["Routed inbox", "Capability matching", "Project workspace + artifacts", "Credit ledger"],
    accent: "from-[var(--grad-1)] to-[var(--grad-2)]",
  },
  {
    href: "/portals/industry",
    icon: Building2,
    name: "Industry",
    nameHi: "उद्योग",
    tagline: "CSR spend against verified, hazard-linked demand.",
    body:
      "Discover challenges by district and hazard, register interest, fund a bounty, and export a CSR report where every claimed outcome is citizen-confirmed or visibly grey.",
    points: ["Discovery filters", "Interest → response thread", "Bounty funding", "CSR export"],
    accent: "from-[var(--grad-4)] to-[var(--grad-1)]",
  },
] as const;

/** The four load-bearing mechanisms. Each is a claim we can click through to. */
const MECHANISMS = [
  {
    icon: Timer,
    title: "No challenge dies silently",
    body:
      "Every challenge in a non-terminal state holds an open SLA deadline. A reaper runs every five minutes and escalates up a ladder. A CI query fails the build if a single row is missing.",
    href: "/gov/sla",
    hrefLabel: "See the SLA board",
  },
  {
    icon: ShieldCheck,
    title: "Credit cannot be erased",
    body:
      "Every contribution is an append-only ledger entry carrying prev_hash and a SHA-256 content hash. No UPDATE, no DELETE — enforced by a Postgres trigger, not by convention.",
    href: "/ledger",
    hrefLabel: "Verify the chain",
  },
  {
    icon: Landmark,
    title: "Hazard linkage is scored, not decorative",
    body:
      "Every challenge carries an explicit NDMA hazard linkage, and that linkage is a weighted term in the priority score. Mitigation in peacetime, not response during an event.",
    href: "/challenges",
    hrefLabel: "Browse challenges",
  },
  {
    icon: FileText,
    title: "Every number opens its own derivation",
    body:
      "The AI proposes structured facts; plain TypeScript decides. Scoring, routing, merging and the human gate above severity 0.7 are all deterministic and all inspectable.",
    href: "/admin/routing",
    hrefLabel: "Open the routing explainer",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      <LandingHeader />

      <main className="flex-1">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-4 pb-6 pt-10 sm:px-6 sm:pt-16">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/4 -z-10 h-72 w-[36rem] max-w-[110vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,var(--grad-1),transparent_65%)] opacity-25 blur-3xl"
          />

          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="milan-rise">
              <span className="milan-glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-[var(--grad-3)] shadow-[0_0_10px_2px_var(--grad-3)]"
                />
                Government of Jharkhand · Disaster risk reduction
              </span>

              <h1 className="mt-5 text-5xl font-bold tracking-tight sm:text-7xl">Milan</h1>
              <div aria-hidden className="milan-hairline mt-4 h-px w-40 rounded-full" />

              <p className="mt-5 text-lg leading-relaxed text-foreground">
                Milan turns a verified local problem into a{" "}
                <strong className="font-semibold">time-bound, routed research assignment</strong>{" "}
                for a university team — with a hash-chained credit ledger so nobody&rsquo;s
                contribution can be erased, and an SLA clock so no challenge can silently die.
              </p>

              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                This is mitigation and preparedness, not response. It is not a grievance portal: a
                complaint with a known fix belongs with CPGRAMS, and we forward it there — and tell
                the citizen where it went. An unsolved problem belongs in a lab, with a clock on it.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/submit">
                    Report a problem <ArrowRight aria-hidden className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/challenges">Browse live challenges</Link>
                </Button>
              </div>
            </div>

            {/* The map is orientation, not evidence — the real geometry is the
                MapLibre basemap on /challenges. */}
            <div className="relative milan-rise">
              <IndiaMap className="mx-auto w-full max-w-md drop-shadow-[0_24px_60px_rgba(0,0,0,0.25)]" />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Piloting in Jharkhand · designed to generalise to any state
              </p>
            </div>
          </div>
        </section>

        {/* ── The three portals ──────────────────────────────────────────── */}
        <section
          id="portals"
          aria-labelledby="portals-heading"
          className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6"
        >
          <h2 id="portals-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Three portals, one pipeline
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The same challenge appears in all three, at different depths. A citizen sees a status.
            A university sees a scoped assignment with a deadline. A firm sees verified demand with
            a hazard linkage and a price.
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {PORTALS.map(({ href, icon: Icon, name, nameHi, tagline, body, points, accent }) => (
              <Link
                key={href}
                href={href}
                className="milan-glass group relative flex flex-col overflow-hidden rounded-2xl p-6 transition-all hover:-translate-y-1 hover:border-[var(--grad-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span aria-hidden className="milan-hairline absolute inset-x-0 top-0 h-px opacity-70" />
                <span
                  aria-hidden
                  className={`flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-white transition-transform group-hover:scale-110`}
                >
                  <Icon className="size-5" />
                </span>

                <span className="mt-4 text-lg font-semibold">{name}</span>
                <span lang="hi" className="text-sm text-muted-foreground">
                  {nameHi}
                </span>
                <span className="mt-2 text-sm font-medium milan-gradient-text">{tagline}</span>
                <span className="mt-2 text-sm leading-snug text-muted-foreground">{body}</span>

                <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--grad-3)]"
                      />
                      {p}
                    </li>
                  ))}
                </ul>

                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold milan-gradient-text">
                  Enter portal
                  <ArrowRight
                    aria-hidden
                    className="size-4 text-[var(--grad-3)] transition-transform group-hover:translate-x-1"
                  />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Mechanisms ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="mechanism-heading"
          className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6"
        >
          <h2 id="mechanism-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            What holds it up
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {MECHANISMS.map(({ icon: Icon, title, body, href, hrefLabel }) => (
              <div key={title} className="milan-glass rounded-2xl p-6">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-lg bg-foreground/10 text-[var(--grad-2)]"
                  >
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="text-base font-semibold">{title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
                <Link
                  href={href}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold milan-gradient-text"
                >
                  {hrefLabel} <ArrowRight aria-hidden className="size-4 text-[var(--grad-3)]" />
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ── Government strip ───────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="milan-glass flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Government &amp; district officers</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                The human gate above severity 0.7, district verification queues, the SLA escalation
                board and the emergency broadcast all sit behind a signed-in government role.
              </p>
            </div>
            <Button asChild variant="outline" size="lg" className="shrink-0">
              <Link href="/gov">Open the government console</Link>
            </Button>
          </div>
        </section>
      </main>

      <LandingFooter />
    </>
  );
}
